// Package data provides an in-memory seeded dataset so the gateway returns
// realistic JSON immediately without requiring TimescaleDB / MongoDB setup.
//
// In production this layer is replaced by SQL/Mongo queries; the handler
// signatures stay the same.
package data

import (
	"math"
	"math/rand"
	"sort"
	"strings"
	"time"
)

type Trader struct {
	ID            string    `json:"id"`
	WalletAddress string    `json:"walletAddress"`
	Handle        string    `json:"handle"`
	AvatarColor   string    `json:"avatarColor"`
	Protocols     []string  `json:"protocols"`
	RiskLevel     string    `json:"riskLevel"`
	FollowerCount int       `json:"followerCount"`
	Verified      bool      `json:"verified"`
	Badge         string    `json:"badge,omitempty"`
	LastActive    time.Time `json:"lastActive"`
	CreatedAt     time.Time `json:"createdAt"`
	Stats         struct {
		ROI30d            float64 `json:"roi30d"`
		ROI90d            float64 `json:"roi90d"`
		ROIAllTime        float64 `json:"roiAllTime"`
		SharpeRatio       float64 `json:"sharpeRatio"`
		MaxDrawdownPct    float64 `json:"maxDrawdownPct"`
		WinRatePct        float64 `json:"winRatePct"`
		AvgTradeDurHours  float64 `json:"avgTradeDurationHours"`
		TotalTrades       int     `json:"totalTrades"`
		PnLUsd30d         float64 `json:"pnlUsd30d"`
	} `json:"stats"`
}

type Signal struct {
	ID         string    `json:"id"`
	Asset      string    `json:"asset"`
	Direction  string    `json:"direction"`
	Confidence float64   `json:"confidence"`
	Source     string    `json:"source"`
	Reasoning  string    `json:"reasoning"`
	CreatedAt  time.Time `json:"createdAt"`
	IsActive   bool      `json:"isActive"`
}

type Asset struct {
	Symbol            string    `json:"symbol"`
	Name              string    `json:"name"`
	Price             float64   `json:"price"`
	PriceChange24hPct float64   `json:"priceChange24hPct"`
	Volume24hUsd      int64     `json:"volume24hUsd"`
	OpenInterestUsd   int64     `json:"openInterestUsd,omitempty"`
	FundingRate       float64   `json:"fundingRate,omitempty"`
	Protocol          string    `json:"protocol"`
	Category          string    `json:"category"`
	Sparkline         []float64 `json:"sparkline"`
}

type Position struct {
	ID                string    `json:"id"`
	Symbol            string    `json:"symbol"`
	Side              string    `json:"side"`
	SizeUsd           float64   `json:"sizeUsd"`
	EntryPrice        float64   `json:"entryPrice"`
	CurrentPrice      float64   `json:"currentPrice"`
	UnrealizedPnl     float64   `json:"unrealizedPnl"`
	UnrealizedPnlPct  float64   `json:"unrealizedPnlPct"`
	Leverage          int       `json:"leverage"`
	Protocol          string    `json:"protocol"`
	OpenedAt          time.Time `json:"openedAt"`
	IsCopied          bool      `json:"isCopied"`
}

type Portfolio struct {
	Address          string     `json:"address"`
	TotalValueUsd    float64    `json:"totalValueUsd"`
	UnrealizedPnlUsd float64    `json:"unrealizedPnlUsd"`
	RealizedPnlUsd   float64    `json:"realizedPnlUsd"`
	DailyPnlPct      float64    `json:"dailyPnlPct"`
	WeeklyPnlPct     float64    `json:"weeklyPnlPct"`
	MonthlyPnlPct    float64    `json:"monthlyPnlPct"`
	Positions        []Position `json:"positions"`
}

// ─── Seed data generation ─────────────────────────────────────────────────────

var (
	rng     = rand.New(rand.NewSource(42))
	traders []Trader
	signals []Signal
	assets  []Asset
	positions []Position
	portfolio Portfolio
)

func init() {
	traders = generateTraders()
	signals = generateSignals()
	assets = generateAssets()
	positions = generatePositions()
	portfolio = Portfolio{
		Address:          "0x4f3a2e8f1c9d5b6a4e3f2c1d0b9a8e7f6c5d4b29e",
		TotalValueUsd:    48_320.00,
		UnrealizedPnlUsd: 3_812.40,
		RealizedPnlUsd:   12_840.50,
		DailyPnlPct:      5.84,
		WeeklyPnlPct:     12.4,
		MonthlyPnlPct:    38.7,
		Positions:        positions[:7],
	}
}

func GetTraders() []Trader   { return traders }
func GetSignals() []Signal   { return signals }
func GetAssets() []Asset     { return assets }
func GetPositions() []Position { return positions }
func GetPortfolio() Portfolio { return portfolio }

func GetTraderByID(id string) (Trader, bool) {
	for _, t := range traders {
		if t.ID == id {
			return t, true
		}
	}
	return Trader{}, false
}

func GetAssetBySymbol(symbol string) (Asset, bool) {
	for _, a := range assets {
		if strings.EqualFold(a.Symbol, symbol) {
			return a, true
		}
	}
	return Asset{}, false
}

// ─── Generators ───────────────────────────────────────────────────────────────

var traderHandles = []string{
	"0xAlpha.eth", "defiwhale", "polyking", "sigmatrade.eth", "chainmaxi",
	"perp_pilgrim", "0xVeritas", "yield.eth", "chrono.lens", "shorting_god",
	"trend.captain", "tape.reader", "liqhunter.eth", "alpha.minimal", "quantbro",
	"macro.dad", "delta.ninja", "vega.queen", "0xStarLord", "BlockBard",
	"leverage.lover", "midcurve.eth", "bigbrain.lab", "satoshi.disciple", "moneymouth.eth",
	"rektpilled", "fader.fade", "diamond.glove", "0xVisigoth", "moonbase.alpha",
	"permabull.dao", "permabear.dao", "ironcondor.eth", "gamma.giant", "theta.gang",
	"0xMercury", "evergreen.cap", "phoenix.fund", "obsidian.eth", "asymmetric.bet",
}

var avatarColors = []string{
	"from-cyan-500 to-blue-600",
	"from-violet-500 to-purple-600",
	"from-emerald-500 to-teal-600",
	"from-amber-500 to-orange-600",
	"from-pink-500 to-rose-600",
	"from-blue-500 to-indigo-600",
	"from-fuchsia-500 to-pink-600",
	"from-lime-500 to-emerald-600",
}

var protocols = []string{"hyperliquid", "polymarket", "drift", "gmx", "aevo"}
var riskLevels = []string{"low", "medium", "high"}

func generateTraders() []Trader {
	out := make([]Trader, 0, len(traderHandles))
	for i, handle := range traderHandles {
		roi30 := -15 + rng.Float64()*335
		win := 45 + rng.Float64()*37
		t := Trader{
			ID:            "trader-" + itoa(i+1),
			WalletAddress: fakeAddress(i + 1),
			Handle:        handle,
			AvatarColor:   avatarColors[i%len(avatarColors)],
			Protocols:     []string{protocols[rng.Intn(len(protocols))]},
			RiskLevel:     riskLevels[rng.Intn(len(riskLevels))],
			FollowerCount: 120 + rng.Intn(4880),
			Verified:      i < 20,
			LastActive:    time.Now().Add(-time.Duration(rng.Intn(3600)) * time.Second),
			CreatedAt:     time.Now().Add(-time.Duration(i*24) * time.Hour),
		}
		if i < 5 { t.Badge = "elite" } else if i < 20 { t.Badge = "verified" }
		t.Stats.ROI30d = round1(roi30)
		t.Stats.ROI90d = round1(roi30 * (1.5 + rng.Float64()))
		t.Stats.ROIAllTime = round1(roi30 * (2.0 + rng.Float64()*3))
		t.Stats.SharpeRatio = round2(0.4 + rng.Float64()*3.8)
		t.Stats.MaxDrawdownPct = round1(5 + rng.Float64()*30)
		t.Stats.WinRatePct = round1(win)
		t.Stats.AvgTradeDurHours = round1(0.5 + rng.Float64()*72)
		t.Stats.TotalTrades = 50 + rng.Intn(4950)
		t.Stats.PnLUsd30d = round0(roi30 * (800 + rng.Float64()*4200))
		out = append(out, t)
	}
	sort.Slice(out, func(i, j int) bool { return out[i].Stats.ROI30d > out[j].Stats.ROI30d })
	return out
}

var signalAssets = []string{"BTC", "ETH", "SOL", "ARB", "OP", "AVAX", "DOGE", "TIA", "SUI", "INJ", "LINK", "RNDR"}
var signalSources = []string{"finbert", "on_chain", "twitter", "reddit", "telegram", "technical", "whale_alert"}
var signalDirs = []string{"buy", "sell", "hold"}

var signalReasonings = map[string][]string{
	"finbert":     {"Cluster of bullish FinBERT-scored articles in last 4h (avg 0.84)", "Negative sentiment spike across CT — short squeeze risk"},
	"on_chain":   {"8 whale wallets accumulated 14k tokens in last 6h", "Net exchange outflow of $42M over 24h"},
	"twitter":    {"@cobie + @hsaka mentions spiked 8x baseline"},
	"reddit":     {"r/cryptocurrency mentions up 340% w/w"},
	"telegram":   {"Premium TG group accumulation calls aligned"},
	"technical":  {"Bullish MACD cross on 4h with rising volume", "Failed breakdown below 200d MA with reclaim"},
	"whale_alert": {"$8.4M USDC → asset swap on 1inch by known whale"},
}

func generateSignals() []Signal {
	out := make([]Signal, 30)
	for i := 0; i < 30; i++ {
		src := signalSources[rng.Intn(len(signalSources))]
		reasons := signalReasonings[src]
		out[i] = Signal{
			ID:         "signal-" + itoa(i+1),
			Asset:      signalAssets[rng.Intn(len(signalAssets))],
			Direction:  signalDirs[rng.Intn(len(signalDirs))],
			Confidence: round2(0.55 + rng.Float64()*0.42),
			Source:     src,
			Reasoning:  reasons[rng.Intn(len(reasons))],
			CreatedAt:  time.Now().Add(-time.Duration(i*60+rng.Intn(60)) * time.Second),
			IsActive:   rng.Float64() > 0.15,
		}
	}
	sort.Slice(out, func(i, j int) bool { return out[i].CreatedAt.After(out[j].CreatedAt) })
	return out
}

type assetSeed struct {
	Symbol, Name, Category, Protocol string
	Price                             float64
}

var assetSeeds = []assetSeed{
	{"BTC", "Bitcoin", "perp", "hyperliquid", 67_842.50},
	{"ETH", "Ethereum", "perp", "hyperliquid", 3_412.18},
	{"SOL", "Solana", "perp", "hyperliquid", 178.42},
	{"ARB", "Arbitrum", "perp", "hyperliquid", 1.24},
	{"OP", "Optimism", "perp", "hyperliquid", 2.41},
	{"AVAX", "Avalanche", "perp", "hyperliquid", 38.21},
	{"LINK", "Chainlink", "perp", "hyperliquid", 14.82},
	{"DOGE", "Dogecoin", "perp", "hyperliquid", 0.182},
	{"INJ", "Injective", "perp", "drift", 27.40},
	{"TIA", "Celestia", "perp", "drift", 8.94},
	{"SEI", "Sei", "perp", "drift", 0.84},
	{"SUI", "Sui", "perp", "drift", 1.31},
	{"APT", "Aptos", "perp", "drift", 9.18},
	{"RNDR", "Render", "perp", "hyperliquid", 9.42},
	{"ATOM", "Cosmos", "perp", "hyperliquid", 8.41},
	{"NEAR", "Near", "perp", "hyperliquid", 6.23},
	{"FIL", "Filecoin", "perp", "hyperliquid", 4.92},
	{"LTC", "Litecoin", "perp", "hyperliquid", 79.41},
	{"XRP", "XRP", "perp", "hyperliquid", 0.62},
	{"UNI", "Uniswap", "spot", "hyperliquid", 8.41},
	{"AAVE", "Aave", "spot", "hyperliquid", 102.42},
	{"MKR", "Maker", "spot", "hyperliquid", 2_410.00},
	{"LDO", "Lido DAO", "spot", "hyperliquid", 2.18},
	{"TRUMP-2024", "Trump wins 2024", "prediction", "polymarket", 0.51},
	{"FED-CUT-MAR", "Fed cut in March", "prediction", "polymarket", 0.34},
	{"BTC-100K-EOY", "BTC ≥ $100k EOY", "prediction", "polymarket", 0.68},
}

func generateAssets() []Asset {
	out := make([]Asset, len(assetSeeds))
	for i, s := range assetSeeds {
		spark := make([]float64, 24)
		v := s.Price
		for j := 0; j < 24; j++ {
			v *= 1 + (rng.Float64()-0.5)*0.04
			spark[j] = round4(v)
		}
		a := Asset{
			Symbol:            s.Symbol,
			Name:              s.Name,
			Price:             s.Price,
			PriceChange24hPct: round2(-8 + rng.Float64()*20),
			Volume24hUsd:      int64(1_000_000 + rng.Intn(800_000_000)),
			Protocol:          s.Protocol,
			Category:          s.Category,
			Sparkline:         spark,
		}
		if s.Category == "perp" {
			a.OpenInterestUsd = int64(5_000_000 + rng.Intn(1_200_000_000))
			a.FundingRate = round4(-0.04 + rng.Float64()*0.12)
		}
		out[i] = a
	}
	return out
}

var positionAssets = []string{"ETH-USD", "BTC-USD", "SOL-USD", "ARB-USD", "DOGE-USD", "SUI-USD", "TIA-USD", "TRUMP-2024", "FED-CUT-MAR"}

func generatePositions() []Position {
	out := make([]Position, 20)
	for i := 0; i < 20; i++ {
		side := "long"
		if rng.Float64() <= 0.4 { side = "short" }
		entry := 0.4 + rng.Float64()*70_000
		drift := 1 + (rng.Float64()-0.45)*0.1
		current := entry * drift
		size := float64(500 + rng.Intn(11_500))
		pnlPct := (current/entry - 1) * 100
		if side == "short" { pnlPct = -pnlPct }
		levOpts := []int{1, 2, 3, 5, 10}
		out[i] = Position{
			ID:               "pos-" + itoa(i+1),
			Symbol:           positionAssets[rng.Intn(len(positionAssets))],
			Side:             side,
			SizeUsd:          size,
			EntryPrice:       round4(entry),
			CurrentPrice:     round4(current),
			UnrealizedPnl:    round2(size * pnlPct / 100),
			UnrealizedPnlPct: round2(pnlPct),
			Leverage:         levOpts[rng.Intn(len(levOpts))],
			Protocol:         protocols[rng.Intn(3)],
			OpenedAt:         time.Now().Add(-time.Duration(i) * time.Hour),
			IsCopied:         i%3 == 0,
		}
	}
	return out
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

func itoa(n int) string {
	if n == 0 { return "0" }
	neg := n < 0
	if neg { n = -n }
	var b [20]byte
	i := len(b)
	for n > 0 {
		i--
		b[i] = byte('0' + n%10)
		n /= 10
	}
	if neg { i--; b[i] = '-' }
	return string(b[i:])
}

func round0(f float64) float64 { return math.Round(f) }
func round1(f float64) float64 { return math.Round(f*10) / 10 }
func round2(f float64) float64 { return math.Round(f*100) / 100 }
func round4(f float64) float64 { return math.Round(f*10000) / 10000 }

func fakeAddress(seed int) string {
	const hex = "0123456789abcdef"
	out := make([]byte, 42)
	out[0] = '0'; out[1] = 'x'
	s := seed
	for i := 2; i < 42; i++ {
		s = (s*9301 + 49297) % 233280
		out[i] = hex[s%16]
	}
	return string(out)
}
