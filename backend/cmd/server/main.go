package main

import (
	"context"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github-assistant/backend/internal/ai"
	"github-assistant/backend/internal/auth"
	"github-assistant/backend/internal/config"
	"github-assistant/backend/internal/db"
	"github-assistant/backend/internal/github"
	"github-assistant/backend/internal/handlers"
	"github-assistant/backend/internal/models"
	"github-assistant/backend/internal/redis"
	"github-assistant/backend/internal/vector"
	"github-assistant/backend/internal/worker"

	"github.com/gin-gonic/gin"
	"github.com/joho/godotenv"
)

func main() {
	// 1. logging
	godotenv.Load()
	logger := slog.New(slog.NewJSONHandler(os.Stdout, &slog.HandlerOptions{Level: slog.LevelInfo}))
	slog.SetDefault(logger)

	slog.Info("Starting GitHub Repository Assistant server...")

	// 2. Load configurations
	cfg := config.LoadConfig()

	// 3. Connect to Postgres & AutoMigrate
	database, err := db.InitDB(cfg.DatabaseURL)
	if err != nil {
		slog.Error("Failed to initialize database", "error", err)
		os.Exit(1)
	}

	// 4. Connect to Redis (Warning only, keep running if Redis is offline)
	var redisClient *redis.RedisClient
	redisClient, err = redis.InitRedis(cfg.RedisAddr, cfg.RedisPass)
	if err != nil {
		slog.Warn("Failed connecting to Redis (caching and rate limiting will be disabled)", "error", err)
	}
	_ = redisClient

	// 5. Select and Initialize AI service
	var aiSvc ai.AIService
	if cfg.GeminiKey != "" {
		slog.Info("Configured Gemini AI service")
		aiSvc = ai.NewGeminiService(cfg.GeminiKey)
	} else if cfg.OpenAIKey != "" {
		slog.Info("Configured OpenAI AI service")
		aiSvc = ai.NewOpenAIService(cfg.OpenAIKey)
	} else {
		// Instantiating a local fallback/mock service for developer friendliness
		slog.Warn("No Gemini or OpenAI API keys found! Booting in Local Mock AI mode.")
		aiSvc = &mockAIService{}
	}

	// 6. Setup clients
	ghClient := github.NewGitHubClient(cfg.GitHubToken)
	qdrantClient := vector.NewQdrantClient(cfg.QdrantHost, cfg.QdrantPort)

	// 7. Setup & Start Ingestion Worker
	workerPool := worker.NewWorker(database, ghClient, qdrantClient, aiSvc)
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	workerPool.Start(ctx, 3)

	// 8. Initialize Authentication Service
	authSvc := auth.NewAuthService(auth.AuthConfig{
		JWTSecret:    cfg.JWTSecret,
		ClientID:     cfg.GoogleClientID,
		ClientSecret: cfg.GoogleClientSecret,
		RedirectURL:  cfg.GoogleRedirectURL,
	})

	// 9. Initialize Endpoint Handler
	h := handlers.NewHandler(database, authSvc, ghClient, qdrantClient, aiSvc, workerPool, cfg.DevMode)

	// 10. Setup Gin engine
	router := gin.New()
	router.Use(gin.Logger(), gin.Recovery())

	// Premium CORS middleware configuration
	router.Use(func(c *gin.Context) {
		origin := c.Request.Header.Get("Origin")
		if origin == "" {
			origin = "http://localhost:3000"
		}
		c.Writer.Header().Set("Access-Control-Allow-Origin", origin)
		c.Writer.Header().Set("Access-Control-Allow-Credentials", "true")
		c.Writer.Header().Set("Access-Control-Allow-Headers", "Content-Type, Content-Length, Accept-Encoding, X-CSRF-Token, Authorization, accept, origin, Cache-Control, X-Requested-With")
		c.Writer.Header().Set("Access-Control-Allow-Methods", "POST, OPTIONS, GET, PUT, DELETE")

		if c.Request.Method == "OPTIONS" {
			c.AbortWithStatus(204)
			return
		}
		c.Next()
	})

	// Register API Routes
	api := router.Group("/api")
	{
		// Public Authentication Routes
		authGroup := api.Group("/auth")
		{
			authGroup.GET("/login/google", h.HandleGoogleLogin)
			authGroup.GET("/callback/google", h.HandleGoogleCallback)
			authGroup.POST("/dev-login", h.HandleDevLogin)
		}

		// Protected Routes
		protected := api.Group("")
		protected.Use(authSvc.JWTAuthMiddleware())
		{
			protected.GET("/auth/profile", h.HandleGetProfile)

			// Repositories
			protected.GET("/repos", h.HandleListRepos)
			protected.POST("/repos", h.HandleCreateRepo)
			protected.GET("/repos/:id", h.HandleGetRepo)
			protected.DELETE("/repos/:id", h.HandleDeleteRepo)

			// Chats
			protected.POST("/chat/sessions", h.HandleCreateSession)
			protected.GET("/chat/sessions", h.HandleListSessions)
			protected.GET("/chat/sessions/:id", h.HandleGetSession)
			protected.POST("/chat/sessions/:id/message", h.HandleSendMessageStream)
		}
	}

	// 11. Graceful Shutdown Config
	srv := &http.Server{
		Addr:    ":" + cfg.Port,
		Handler: router,
	}

	go func() {
		slog.Info("HTTP Server is listening", "port", cfg.Port)
		if err := srv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			slog.Error("HTTP Server listen failed", "error", err)
			os.Exit(1)
		}
	}()

	quit := make(chan os.Signal, 1)
	signal.Notify(quit, syscall.SIGINT, syscall.SIGTERM)
	<-quit

	slog.Info("Shutting down HTTP Server gracefully...")
	shutdownCtx, shutdownCancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer shutdownCancel()

	if err := srv.Shutdown(shutdownCtx); err != nil {
		slog.Error("Server forced to shutdown", "error", err)
	}

	slog.Info("Server exited.")
}

// Mock AI Service Implementation for Local Test

type mockAIService struct{}

func (m *mockAIService) GetModelName() string {
	return "mock-ai-model"
}

func (m *mockAIService) GetVectorDimension() int {
	return 768
}

func (m *mockAIService) GetEmbedding(ctx context.Context, text string) ([]float32, error) {
	// Return a mock vector of size 768
	v := make([]float32, 768)
	for i := 0; i < len(v); i++ {
		v[i] = 0.01 * float32(i%100)
	}
	return v, nil
}

func (m *mockAIService) GenerateStream(ctx context.Context, systemPrompt string, chatHistory []models.Message, question string) (<-chan ai.StreamResult, error) {
	out := make(chan ai.StreamResult, 5)

	go func() {
		defer close(out)
		time.Sleep(500 * time.Millisecond)
		out <- ai.StreamResult{Text: "This is a **mock response** from the local AI service.\n\n"}
		time.Sleep(300 * time.Millisecond)
		out <- ai.StreamResult{Text: "Since no API keys were configured, I am running in Developer fallback mode. "}
		time.Sleep(300 * time.Millisecond)
		out <- ai.StreamResult{Text: "I found references to your question in the codebase files.\n\n"}
		time.Sleep(300 * time.Millisecond)
		out <- ai.StreamResult{Text: "Check the citation links below or check `config.go` for setting your keys."}
	}()

	return out, nil
}
