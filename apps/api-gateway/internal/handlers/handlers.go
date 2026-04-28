package handlers

import (
	"net/http"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/golang-jwt/jwt/v5"
)

// ─── Auth ─────────────────────────────────────────────────────────────────────

func VerifyWallet(c *gin.Context) {
	var req struct {
		Address   string `json:"address" binding:"required"`
		Signature string `json:"signature" binding:"required"`
		Message   string `json:"message" binding:"required"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	// TODO: verify EIP-191 personal_sign signature with viem/go-ethereum

	token := jwt.NewWithClaims(jwt.SigningMethodHS256, jwt.MapClaims{
		"address": req.Address,
		"userId":  req.Address,
		"iat":     time.Now().Unix(),
		"exp":     time.Now().Add(7 * 24 * time.Hour).Unix(),
	})

	signed, err := token.SignedString([]byte("dev-secret-change-in-production"))
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "token signing failed"})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"accessToken": signed,
		"user": gin.H{
			"address": req.Address,
			"id":      req.Address,
		},
	})
}

func RefreshToken(c *gin.Context) {
	c.JSON(http.StatusOK, gin.H{"message": "refresh token stub"})
}

// ─── Traders ──────────────────────────────────────────────────────────────────

func ListTraders(c *gin.Context) {
	limit := c.DefaultQuery("limit", "50")
	sortBy := c.DefaultQuery("sortBy", "roi")
	c.JSON(http.StatusOK, gin.H{
		"data":  []gin.H{},
		"meta":  gin.H{"limit": limit, "sortBy": sortBy, "total": 0},
	})
}

func GetTrader(c *gin.Context) {
	id := c.Param("id")
	c.JSON(http.StatusOK, gin.H{"id": id, "handle": "stub_trader"})
}

func GetTraderPositions(c *gin.Context) {
	c.JSON(http.StatusOK, gin.H{"data": []gin.H{}, "traderId": c.Param("id")})
}

func GetTraderHistory(c *gin.Context) {
	c.JSON(http.StatusOK, gin.H{"data": []gin.H{}, "traderId": c.Param("id")})
}

func GetTraderStats(c *gin.Context) {
	c.JSON(http.StatusOK, gin.H{"traderId": c.Param("id"), "roi": 0, "sharpe": 0})
}

// ─── Signals ──────────────────────────────────────────────────────────────────

func ListSignals(c *gin.Context) {
	c.JSON(http.StatusOK, gin.H{"data": []gin.H{}, "meta": gin.H{"total": 0}})
}

func GetLatestSignals(c *gin.Context) {
	c.JSON(http.StatusOK, gin.H{"data": []gin.H{}})
}

// ─── Markets ──────────────────────────────────────────────────────────────────

func ListMarkets(c *gin.Context) {
	c.JSON(http.StatusOK, gin.H{"data": []gin.H{}})
}

func GetMarket(c *gin.Context) {
	c.JSON(http.StatusOK, gin.H{"symbol": c.Param("symbol")})
}

// ─── Portfolio (protected) ────────────────────────────────────────────────────

func GetPortfolio(c *gin.Context) {
	address, _ := c.Get("address")
	c.JSON(http.StatusOK, gin.H{"address": address, "totalValue": 0, "positions": []gin.H{}})
}

func GetPortfolioPositions(c *gin.Context) {
	c.JSON(http.StatusOK, gin.H{"data": []gin.H{}})
}

func GetPortfolioHistory(c *gin.Context) {
	c.JSON(http.StatusOK, gin.H{"data": []gin.H{}})
}

func GetPortfolioStats(c *gin.Context) {
	c.JSON(http.StatusOK, gin.H{"roi": 0, "sharpe": 0, "maxDrawdown": 0})
}

// ─── Copy Trading (protected) ─────────────────────────────────────────────────

func ListCopyConfigs(c *gin.Context) {
	c.JSON(http.StatusOK, gin.H{"data": []gin.H{}})
}

func StartCopy(c *gin.Context) {
	var req map[string]any
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusCreated, gin.H{"id": "copy-stub-id", "config": req})
}

func GetCopyConfig(c *gin.Context) {
	c.JSON(http.StatusOK, gin.H{"id": c.Param("id")})
}

func UpdateCopyConfig(c *gin.Context) {
	c.JSON(http.StatusOK, gin.H{"id": c.Param("id"), "updated": true})
}

func StopCopy(c *gin.Context) {
	c.JSON(http.StatusOK, gin.H{"id": c.Param("id"), "stopped": true})
}

// ─── Orders (protected) ───────────────────────────────────────────────────────

func ListOrders(c *gin.Context) {
	c.JSON(http.StatusOK, gin.H{"data": []gin.H{}})
}

func PlaceOrder(c *gin.Context) {
	c.JSON(http.StatusCreated, gin.H{"id": "order-stub-id"})
}

func CancelOrder(c *gin.Context) {
	c.JSON(http.StatusOK, gin.H{"id": c.Param("id"), "cancelled": true})
}
