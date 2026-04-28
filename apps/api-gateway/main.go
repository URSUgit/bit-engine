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

	r := gin.New()
	r.Use(gin.Logger(), gin.Recovery())

	// CORS
	r.Use(cors.New(cors.Config{
		AllowOrigins:     cfg.AllowedOrigins,
		AllowMethods:     []string{"GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"},
		AllowHeaders:     []string{"Authorization", "Content-Type", "X-Request-ID"},
		ExposeHeaders:    []string{"X-Request-ID"},
		AllowCredentials: true,
	}))

	// Health
	r.GET("/health", func(c *gin.Context) {
		c.JSON(200, gin.H{"status": "ok", "service": "api-gateway"})
	})

	// Public API v1
	v1 := r.Group("/api/v1")
	{
		// Auth
		auth := v1.Group("/auth")
		{
			auth.POST("/verify", handlers.VerifyWallet)
			auth.POST("/refresh", handlers.RefreshToken)
		}

		// Traders (public)
		traders := v1.Group("/traders")
		{
			traders.GET("", handlers.ListTraders)
			traders.GET("/:id", handlers.GetTrader)
			traders.GET("/:id/positions", handlers.GetTraderPositions)
			traders.GET("/:id/history", handlers.GetTraderHistory)
			traders.GET("/:id/stats", handlers.GetTraderStats)
		}

		// Signals (public)
		signals := v1.Group("/signals")
		{
			signals.GET("", handlers.ListSignals)
			signals.GET("/latest", handlers.GetLatestSignals)
		}

		// Markets (public)
		v1.GET("/markets", handlers.ListMarkets)
		v1.GET("/markets/:symbol", handlers.GetMarket)

		// Protected routes
		protected := v1.Group("")
		protected.Use(middleware.JWT(cfg.JWTSecret))
		{
			// Portfolio
			portfolio := protected.Group("/portfolio")
			{
				portfolio.GET("", handlers.GetPortfolio)
				portfolio.GET("/positions", handlers.GetPortfolioPositions)
				portfolio.GET("/history", handlers.GetPortfolioHistory)
				portfolio.GET("/stats", handlers.GetPortfolioStats)
			}

			// Copy trading
			copy := protected.Group("/copy")
			{
				copy.GET("", handlers.ListCopyConfigs)
				copy.POST("", handlers.StartCopy)
				copy.GET("/:id", handlers.GetCopyConfig)
				copy.PATCH("/:id", handlers.UpdateCopyConfig)
				copy.DELETE("/:id", handlers.StopCopy)
			}

			// Orders
			orders := protected.Group("/orders")
			{
				orders.GET("", handlers.ListOrders)
				orders.POST("", handlers.PlaceOrder)
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
