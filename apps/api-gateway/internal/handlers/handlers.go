package handlers

import (
	"fmt"
	"net/http"
	"strings"
	"time"

	"github.com/bitprivat/api-gateway/internal/auth"
	"github.com/bitprivat/api-gateway/internal/data"
	"github.com/gin-gonic/gin"
	"github.com/golang-jwt/jwt/v5"
)

var (
	nonceStore = auth.NewNonceStore()
	jwtSecret  = []byte("dev-secret-change-in-production")
)

// SetJWTSecret allows main.go to inject the configured secret at startup.
func SetJWTSecret(secret string) {
	if secret != "" {
		jwtSecret = []byte(secret)
	}
}

// ─── Auth (SIWE) ──────────────────────────────────────────────────────────────

func GetNonce(c *gin.Context) {
	address := c.Query("address")
	if address == "" || !strings.HasPrefix(address, "0x") || len(address) != 42 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid address"})
		return
	}
	nonce, issuedAt, err := nonceStore.Issue(address)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "could not generate nonce"})
		return
	}
	c.JSON(http.StatusOK, gin.H{
		"nonce":    nonce,
		"issuedAt": issuedAt.UTC().Format(time.RFC3339),
	})
}

func VerifyWallet(c *gin.Context) {
	var req struct {
		Address   string `json:"address"   binding:"required"`
		Signature string `json:"signature" binding:"required"`
		Message   string `json:"message"   binding:"required"`
		Nonce     string `json:"nonce"     binding:"required"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	// 1. Validate the nonce was issued and is fresh.
	if err := nonceStore.Consume(req.Address, req.Nonce); err != nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": fmt.Sprintf("nonce check failed: %s", err)})
		return
	}

	// 2. Confirm message contains the nonce so a replay with a different
	//    message can't reuse a sig.
	if !strings.Contains(req.Message, req.Nonce) {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "message does not contain nonce"})
		return
	}

	// 3. Recover the signer and confirm it matches the claimed address.
	signer, err := auth.RecoverEIP191Signer(req.Message, req.Signature)
	if err != nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": fmt.Sprintf("signature recovery failed: %s", err)})
		return
	}
	if !strings.EqualFold(signer.Hex(), req.Address) {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "signature does not match claimed address"})
		return
	}

	// 4. Issue JWT.
	token := jwt.NewWithClaims(jwt.SigningMethodHS256, jwt.MapClaims{
		"address": strings.ToLower(req.Address),
		"userId":  strings.ToLower(req.Address),
		"iat":     time.Now().Unix(),
		"exp":     time.Now().Add(7 * 24 * time.Hour).Unix(),
	})
	signed, err := token.SignedString(jwtSecret)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "token signing failed"})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"accessToken": signed,
		"user": gin.H{
			"id":      strings.ToLower(req.Address),
			"address": strings.ToLower(req.Address),
		},
	})
}

func RefreshToken(c *gin.Context) {
	c.JSON(http.StatusOK, gin.H{"message": "refresh stub"})
}

// ─── Traders ──────────────────────────────────────────────────────────────────

func ListTraders(c *gin.Context) { c.JSON(http.StatusOK, data.GetTraders()) }

func GetTrader(c *gin.Context) {
	t, ok := data.GetTraderByID(c.Param("id"))
	if !ok { c.JSON(http.StatusNotFound, gin.H{"error": "trader not found"}); return }
	c.JSON(http.StatusOK, t)
}

func GetTraderPositions(c *gin.Context) { c.JSON(http.StatusOK, data.GetPositions()) }
func GetTraderHistory(c *gin.Context)   { c.JSON(http.StatusOK, []any{}) }
func GetTraderStats(c *gin.Context) {
	t, ok := data.GetTraderByID(c.Param("id"))
	if !ok { c.JSON(http.StatusNotFound, gin.H{"error": "trader not found"}); return }
	c.JSON(http.StatusOK, t.Stats)
}

func GetLeaderboard(c *gin.Context) { c.JSON(http.StatusOK, data.GetTraders()) }

// ─── Signals ──────────────────────────────────────────────────────────────────

func ListSignals(c *gin.Context)      { c.JSON(http.StatusOK, data.GetSignals()) }
func GetLatestSignals(c *gin.Context) {
	all := data.GetSignals()
	limit := 10
	if len(all) < limit { limit = len(all) }
	c.JSON(http.StatusOK, all[:limit])
}

// ─── Markets ──────────────────────────────────────────────────────────────────

func ListMarkets(c *gin.Context) { c.JSON(http.StatusOK, data.GetAssets()) }
func GetMarket(c *gin.Context) {
	a, ok := data.GetAssetBySymbol(c.Param("symbol"))
	if !ok { c.JSON(http.StatusNotFound, gin.H{"error": "market not found"}); return }
	c.JSON(http.StatusOK, a)
}

func GetOrderBook(c *gin.Context) {
	a, ok := data.GetAssetBySymbol(c.Param("symbol"))
	if !ok { c.JSON(http.StatusNotFound, gin.H{"error": "market not found"}); return }

	tick := a.Price * 0.0001
	bids := make([]gin.H, 15)
	asks := make([]gin.H, 15)
	bidTotal, askTotal := 0.0, 0.0
	for i := 0; i < 15; i++ {
		bidSize := 5 + float64(i%7)*4
		askSize := 5 + float64(i%5)*4
		bidTotal += bidSize; askTotal += askSize
		bids[i] = gin.H{"price": a.Price - tick*float64(i+1), "size": bidSize, "total": bidTotal}
		asks[i] = gin.H{"price": a.Price + tick*float64(i+1), "size": askSize, "total": askTotal}
	}
	c.JSON(http.StatusOK, gin.H{"bids": bids, "asks": asks})
}

// ─── Portfolio (auth required) ────────────────────────────────────────────────

func GetPortfolio(c *gin.Context)         { c.JSON(http.StatusOK, data.GetPortfolio()) }
func GetPortfolioPositions(c *gin.Context) { c.JSON(http.StatusOK, data.GetPositions()) }
func GetPortfolioHistory(c *gin.Context)   { c.JSON(http.StatusOK, []any{}) }
func GetPortfolioStats(c *gin.Context) {
	p := data.GetPortfolio()
	c.JSON(http.StatusOK, gin.H{
		"totalValueUsd":  p.TotalValueUsd,
		"unrealizedPnl":  p.UnrealizedPnlUsd,
		"realizedPnl":    p.RealizedPnlUsd,
		"dailyPnlPct":    p.DailyPnlPct,
		"weeklyPnlPct":   p.WeeklyPnlPct,
		"monthlyPnlPct":  p.MonthlyPnlPct,
	})
}

// ─── Copy Trading (stubbed) ───────────────────────────────────────────────────

func ListCopyConfigs(c *gin.Context) { c.JSON(http.StatusOK, []any{}) }
func StartCopy(c *gin.Context) {
	var req map[string]any
	_ = c.ShouldBindJSON(&req)
	c.JSON(http.StatusCreated, gin.H{"id": "copy-stub", "config": req})
}
func GetCopyConfig(c *gin.Context)    { c.JSON(http.StatusOK, gin.H{"id": c.Param("id")}) }
func UpdateCopyConfig(c *gin.Context) { c.JSON(http.StatusOK, gin.H{"id": c.Param("id"), "updated": true}) }
func StopCopy(c *gin.Context)         { c.JSON(http.StatusOK, gin.H{"id": c.Param("id"), "stopped": true}) }

// ─── Orders (stubbed) ─────────────────────────────────────────────────────────

func ListOrders(c *gin.Context)  { c.JSON(http.StatusOK, []any{}) }
func PlaceOrder(c *gin.Context)  { c.JSON(http.StatusCreated, gin.H{"id": "order-stub"}) }
func CancelOrder(c *gin.Context) { c.JSON(http.StatusOK, gin.H{"id": c.Param("id"), "cancelled": true}) }

// ─── Backtest (stubbed) ───────────────────────────────────────────────────────

func RunBacktest(c *gin.Context) {
	c.JSON(http.StatusOK, gin.H{
		"id":               "bt-1",
		"strategyName":     "Momentum Breakout v2",
		"startDate":        "2024-01-01",
		"endDate":          "2024-06-01",
		"initialCapitalUsd": 10_000,
		"finalCapitalUsd":   14_820,
		"totalReturnPct":    48.2,
		"annualizedReturnPct": 116.4,
		"sharpeRatio":       2.41,
		"maxDrawdownPct":    12.8,
		"winRatePct":        64.3,
		"totalTrades":       184,
		"profitFactor":      2.18,
		"trades":            []any{},
	})
}
