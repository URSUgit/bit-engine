package config

import (
	"os"
	"strings"

	"github.com/joho/godotenv"
)

type Config struct {
	Env            string
	Host           string
	Port           string
	JWTSecret      string
	AllowedOrigins []string
	RedisURL       string
	MongoURI       string
	DatabaseURL    string
	KafkaBrokers   []string
	TradingEngine  string
	SignalService  string
}

func Load() *Config {
	_ = godotenv.Load("../../.env")

	origins := os.Getenv("ALLOWED_ORIGINS")
	if origins == "" {
		origins = "http://localhost:3000"
	}

	brokers := os.Getenv("KAFKA_BROKERS")
	if brokers == "" {
		brokers = "localhost:9092"
	}

	return &Config{
		Env:            getEnv("APP_ENV", "development"),
		Host:           getEnv("API_GATEWAY_HOST", "0.0.0.0"),
		Port:           getEnv("API_GATEWAY_PORT", "8080"),
		JWTSecret:      getEnv("JWT_SECRET", "dev-secret-change-in-production"),
		AllowedOrigins: strings.Split(origins, ","),
		RedisURL:       getEnv("REDIS_URL", "redis://localhost:6379"),
		MongoURI:       getEnv("MONGO_URI", "mongodb://localhost:27017/bitprivat"),
		DatabaseURL:    getEnv("DATABASE_URL", "postgresql://bitprivat:bitprivat@localhost:5432/bitprivat"),
		KafkaBrokers:   strings.Split(brokers, ","),
		TradingEngine:  getEnv("TRADING_ENGINE_URL", "http://localhost:9090"),
		SignalService:  getEnv("SIGNAL_SERVICE_URL", "http://localhost:8001"),
	}
}

func getEnv(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}
