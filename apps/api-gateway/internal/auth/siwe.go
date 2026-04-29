// Package auth implements Sign-In-With-Ethereum (EIP-4361 inspired) using
// EIP-191 personal_sign signature recovery. Nonces are kept in an in-memory
// store with a 10-minute TTL — for production replace with Redis.
package auth

import (
	"crypto/rand"
	"encoding/hex"
	"errors"
	"fmt"
	"strings"
	"sync"
	"time"

	"github.com/ethereum/go-ethereum/common"
	"github.com/ethereum/go-ethereum/crypto"
)

const nonceTTL = 10 * time.Minute

type nonceEntry struct {
	value     string
	issuedAt  time.Time
}

// NonceStore is a thread-safe in-memory nonce cache keyed by lowercase address.
type NonceStore struct {
	mu      sync.Mutex
	entries map[string]nonceEntry
}

func NewNonceStore() *NonceStore {
	s := &NonceStore{entries: make(map[string]nonceEntry)}
	go s.gcLoop()
	return s
}

// Issue generates a fresh nonce for the given address and remembers it.
func (s *NonceStore) Issue(address string) (string, time.Time, error) {
	b := make([]byte, 16)
	if _, err := rand.Read(b); err != nil {
		return "", time.Time{}, err
	}
	nonce := hex.EncodeToString(b)
	now := time.Now().UTC()

	s.mu.Lock()
	defer s.mu.Unlock()
	s.entries[strings.ToLower(address)] = nonceEntry{value: nonce, issuedAt: now}
	return nonce, now, nil
}

// Consume removes and validates the nonce for the given address. Returns an
// error if the nonce doesn't match or has expired.
func (s *NonceStore) Consume(address, nonce string) error {
	key := strings.ToLower(address)
	s.mu.Lock()
	defer s.mu.Unlock()

	entry, ok := s.entries[key]
	if !ok {
		return errors.New("no nonce issued for address")
	}
	if entry.value != nonce {
		return errors.New("nonce mismatch")
	}
	if time.Since(entry.issuedAt) > nonceTTL {
		delete(s.entries, key)
		return errors.New("nonce expired")
	}
	delete(s.entries, key)
	return nil
}

func (s *NonceStore) gcLoop() {
	t := time.NewTicker(2 * time.Minute)
	defer t.Stop()
	for range t.C {
		s.mu.Lock()
		for k, e := range s.entries {
			if time.Since(e.issuedAt) > nonceTTL {
				delete(s.entries, k)
			}
		}
		s.mu.Unlock()
	}
}

// RecoverEIP191Signer recovers the Ethereum address that signed `message`
// using personal_sign / EIP-191. `signature` is a 0x-prefixed hex string.
func RecoverEIP191Signer(message, signature string) (common.Address, error) {
	sig := strings.TrimPrefix(signature, "0x")
	sigBytes, err := hex.DecodeString(sig)
	if err != nil {
		return common.Address{}, fmt.Errorf("invalid signature hex: %w", err)
	}
	if len(sigBytes) != 65 {
		return common.Address{}, fmt.Errorf("signature must be 65 bytes, got %d", len(sigBytes))
	}

	// Normalize V: secp256k1 expects 0/1, but EIP-191 sigs use 27/28 (or 0/1).
	if sigBytes[64] >= 27 {
		sigBytes[64] -= 27
	}

	prefixed := fmt.Sprintf("\x19Ethereum Signed Message:\n%d%s", len(message), message)
	hash := crypto.Keccak256Hash([]byte(prefixed))

	pubKey, err := crypto.SigToPub(hash.Bytes(), sigBytes)
	if err != nil {
		return common.Address{}, fmt.Errorf("recover signer: %w", err)
	}
	return crypto.PubkeyToAddress(*pubKey), nil
}
