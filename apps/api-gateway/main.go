package main

import (
	"log"

	"github.com/bitprivat/api-gateway/internal/config"
	"github.com/bitprivat/api-gateway/internal/handlers"
	"github.com/bitprivat/api-gateway/internal/middleware"
	"github.com/gin-contrib/cors"
	"github.com/gin-gonic/gin"
)

func main() {
	cfg := config.Load()

	if cfg.Env == "production" {
		gin.SetMode(gin.ReleaseMode)
	}

	handlers.SetJWTSecret(cfg.JWTSecret)

	r := gin.New()
	r.Use(gin.Logger(), gin.Recovery(), middleware.RequestID())

	r.Use(cors.New(cors.Config{
		AllowOrigins:     cfg.AllowedOrigins,
		AllowMethods:     []string{"GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"},
		AllowHeaders:     []string{"Authorization", "Content-Type", "X-Request-ID"},
		ExposeHeaders:    []string{"X-Request-ID"},
		AllowCredentials: true,
	}))

	r.GET("/health", func(c *gin.Context) {
		c.JSON(200, gin.H{"status": "ok", "service": "api-gateway"})
	})

	v1 := r.Group("/api/v1")
	{
		// SIWE auth
		auth := v1.Group("/auth")
		{
			auth.GET("/nonce",   handlers.GetNonce)
			auth.POST("/verify", handlers.VerifyWallet)
			auth.POST("/refresh", handlers.RefreshToken)
		}

		// Public: traders
		traders := v1.Group("/traders")
		{
			traders.GET("",                  handlers.ListTraders)
			traders.GET("/leaderboard",      handlers.GetLeaderboard)
			traders.GET("/:id",              handlers.GetTrader)
			traders.GET("/:id/positions",    handlers.GetTraderPositions)
			traders.GET("/:id/history",      handlers.GetTraderHistory)
			traders.GET("/:id/stats",        handlers.GetTraderStats)
		}

		// Public: signals
		v1.GET("/signals",        handlers.ListSignals)
		v1.GET("/signals/latest", handlers.GetLatestSignals)

		// Public: markets
		v1.GET("/markets",                       handlers.ListMarkets)
		v1.GET("/markets/:symbol",               handlers.GetMarket)
		v1.GET("/markets/:symbol/orderbook",     handlers.GetOrderBook)

		// Public: backtest (stub)
		v1.POST("/backtest", handlers.RunBacktest)

		// Protected: portfolio + copy trading + orders
		protected := v1.Group("")
		protected.Use(middleware.JWT(cfg.JWTSecret))
		{
			portfolio := protected.Group("/portfolio")
			{
				portfolio.GET("",           handlers.GetPortfolio)
				portfolio.GET("/positions", handlers.GetPortfolioPositions)
				portfolio.GET("/history",   handlers.GetPortfolioHistory)
				portfolio.GET("/stats",     handlers.GetPortfolioStats)
			}

			copyG := protected.Group("/copy")
			{
				copyG.GET("",       handlers.ListCopyConfigs)
				copyG.POST("",      handlers.StartCopy)
				copyG.GET("/:id",   handlers.GetCopyConfig)
				copyG.PATCH("/:id", handlers.UpdateCopyConfig)
				copyG.DELETE("/:id", handlers.StopCopy)
			}

			orders := protected.Group("/orders")
			{
				orders.GET("",       handlers.ListOrders)
				orders.POST("",      handlers.PlaceOrder)
				orders.DELETE("/:id", handlers.CancelOrder)
			}
		}
	}

	addr := cfg.Host + ":" + cfg.Port
	log.Printf("[api-gateway] listening on %s (env=%s)", addr, cfg.Env)
	if err := r.Run(addr); err != nil {
		log.Fatalf("server error: %v", err)
	}
}
