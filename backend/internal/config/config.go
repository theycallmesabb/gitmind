package config

import (
	"bufio"
	"os"
	"strconv"
	"strings"
)

type Config struct {
	Port               string
	DatabaseURL        string
	RedisAddr          string
	RedisPass          string
	QdrantHost         string
	QdrantPort         string
	GeminiKey          string
	OpenAIKey          string
	GoogleClientID     string
	GoogleClientSecret string
	GoogleRedirectURL  string
	JWTSecret          string
	DevMode            bool
	GitHubToken        string
}

func LoadConfig() *Config {
	// Load local .env file if it exists
	loadEnvFile(".env")

	port := getEnv("PORT", "8080")
	dbURL := getEnv("DATABASE_URL", "postgres://postgres:postgres@127.0.0.1:5432/github_assistant?sslmode=disable")
	redisAddr := getEnv("REDIS_ADDR", "127.0.0.1:6379")
	redisPass := getEnv("REDIS_PASS", "")
	qdrantHost := getEnv("QDRANT_HOST", "127.0.0.1")
	qdrantPort := getEnv("QDRANT_PORT", "6333")
	geminiKey := getEnv("GEMINI_API_KEY", "")
	openaiKey := getEnv("OPENAI_API_KEY", "")
	googleClientID := getEnv("GOOGLE_CLIENT_ID", "")
	googleClientSecret := getEnv("GOOGLE_CLIENT_SECRET", "")
	googleRedirectURL := getEnv("GOOGLE_REDIRECT_URL", "http://localhost:8080/api/auth/callback/google")
	jwtSecret := getEnv("JWT_SECRET", "super-secret-jwt-key")
	devModeStr := getEnv("DEV_MODE", "true")
	githubToken := getEnv("GITHUB_TOKEN", "")

	devMode, err := strconv.ParseBool(devModeStr)
	if err != nil {
		devMode = true
	}

	return &Config{
		Port:               port,
		DatabaseURL:        dbURL,
		RedisAddr:          redisAddr,
		RedisPass:          redisPass,
		QdrantHost:         qdrantHost,
		QdrantPort:         qdrantPort,
		GeminiKey:          geminiKey,
		OpenAIKey:          openaiKey,
		GoogleClientID:     googleClientID,
		GoogleClientSecret: googleClientSecret,
		GoogleRedirectURL:  googleRedirectURL,
		JWTSecret:          jwtSecret,
		DevMode:            devMode,
		GitHubToken:        githubToken,
	}
}

func getEnv(key, fallback string) string {
	if value, exists := os.LookupEnv(key); exists {
		return value
	}
	return fallback
}

func loadEnvFile(filename string) {
	file, err := os.Open(filename)
	if err != nil {
		return
	}
	defer file.Close()

	scanner := bufio.NewScanner(file)
	for scanner.Scan() {
		line := strings.TrimSpace(scanner.Text())
		if line == "" || strings.HasPrefix(line, "#") {
			continue
		}
		parts := strings.SplitN(line, "=", 2)
		if len(parts) == 2 {
			key := strings.TrimSpace(parts[0])
			val := strings.TrimSpace(parts[1])
			val = strings.Trim(val, `"'`)
			if os.Getenv(key) == "" {
				os.Setenv(key, val)
			}
		}
	}
}
