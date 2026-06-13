package handlers

import (
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github-assistant/backend/internal/ai"
	"github-assistant/backend/internal/auth"
	"github-assistant/backend/internal/github"
	"github-assistant/backend/internal/models"
	"github-assistant/backend/internal/vector"
	"github-assistant/backend/internal/worker"
	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"gorm.io/gorm"
)

type Handler struct {
	db           *gorm.DB
	authSvc      *auth.AuthService
	githubClient *github.GitHubClient
	vectorClient *vector.QdrantClient
	aiSvc        ai.AIService
	worker       *worker.Worker
	devMode      bool
}

func NewHandler(db *gorm.DB, authSvc *auth.AuthService, gh *github.GitHubClient, vec *vector.QdrantClient, aiSvc ai.AIService, w *worker.Worker, devMode bool) *Handler {
	return &Handler{
		db:           db,
		authSvc:      authSvc,
		githubClient: gh,
		vectorClient: vec,
		aiSvc:        aiSvc,
		worker:       w,
		devMode:      devMode,
	}
}

// -----------------------------------------------------------------------------
// Authentication Handlers
// -----------------------------------------------------------------------------

func (h *Handler) HandleGoogleLogin(c *gin.Context) {
	state := uuid.New().String()
	// In production, save state in Redis to verify in callback. For simplicity, we pass state.
	url := h.authSvc.GetGoogleLoginURL(state)
	c.Redirect(http.StatusTemporaryRedirect, url)
}

func (h *Handler) HandleGoogleCallback(c *gin.Context) {
	code := c.Query("code")
	if code == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Code query parameter required"})
		return
	}

	googleUser, err := h.authSvc.GetGoogleUser(c.Request.Context(), code)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	// Find or Create User
	var user models.User
	result := h.db.Where("email = ?", googleUser.Email).First(&user)
	if result.Error != nil {
		if result.Error == gorm.ErrRecordNotFound {
			user = models.User{
				Email:     googleUser.Email,
				Name:      googleUser.Name,
				AvatarURL: googleUser.Picture,
			}
			if err := h.db.Create(&user).Error; err != nil {
				c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to create user"})
				return
			}
		} else {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "Database error"})
			return
		}
	}

	// Generate JWT
	token, err := h.authSvc.GenerateToken(user.ID, user.Email, user.Name)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed generating authentication token"})
		return
	}

	// Redirect frontend with token
	redirectURL := fmt.Sprintf("http://localhost:3000/auth-callback?token=%s", token)
	c.Redirect(http.StatusTemporaryRedirect, redirectURL)
}

func (h *Handler) HandleDevLogin(c *gin.Context) {
	if !h.devMode {
		c.JSON(http.StatusForbidden, gin.H{"error": "Developer Mode is disabled"})
		return
	}

	var req struct {
		Email string `json:"email"`
		Name  string `json:"name"`
	}

	if err := c.ShouldBindJSON(&req); err != nil {
		req.Email = "developer@local.com"
		req.Name = "Developer User"
	}

	var user models.User
	result := h.db.Where("email = ?", req.Email).First(&user)
	if result.Error != nil {
		if result.Error == gorm.ErrRecordNotFound {
			user = models.User{
				Email:     req.Email,
				Name:      req.Name,
				AvatarURL: "https://avatar.vercel.sh/" + req.Email,
			}
			h.db.Create(&user)
		} else {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "Database error"})
			return
		}
	}

	token, err := h.authSvc.GenerateToken(user.ID, user.Email, user.Name)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Token generation failed"})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"token": token,
		"user":  user,
	})
}

func (h *Handler) HandleGetProfile(c *gin.Context) {
	userID := c.MustGet("user_id").(uint)
	var user models.User
	if err := h.db.First(&user, userID).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "User not found"})
		return
	}
	c.JSON(http.StatusOK, user)
}

// -----------------------------------------------------------------------------
// Repository Handlers
// -----------------------------------------------------------------------------

func (h *Handler) HandleListRepos(c *gin.Context) {
	userID := c.MustGet("user_id").(uint)
	var repos []models.Repository
	if err := h.db.Where("user_id = ?", userID).Order("created_at desc").Find(&repos).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, repos)
}

func (h *Handler) HandleCreateRepo(c *gin.Context) {
	userID := c.MustGet("user_id").(uint)

	var req struct {
		URL string `json:"url"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid body"})
		return
	}

	owner, repoName, err := github.ParseRepositoryURL(req.URL)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	// Check if already tracking
	var existing models.Repository
	err = h.db.Where("user_id = ? AND owner = ? AND name = ?", userID, owner, repoName).First(&existing).Error
	if err == nil {
		if existing.Status == "failed" {
			// Automatically reset status, clear error, and re-enqueue indexing job
			existing.Status = "pending"
			existing.ErrorMessage = ""
			existing.ChunkCount = 0
			if err := h.db.Save(&existing).Error; err != nil {
				c.JSON(http.StatusInternalServerError, gin.H{"error": "Database update failed: " + err.Error()})
				return
			}
			// Enqueue background indexing job again
			h.worker.Enqueue(existing.ID)
			c.JSON(http.StatusAccepted, existing)
			return
		}
		c.JSON(http.StatusConflict, gin.H{"error": "Repository already added", "id": existing.ID})
		return
	}

	// Get metadata to verify repo and branch
	meta, err := h.githubClient.GetMetadata(owner, repoName)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Failed fetching repository metadata. Ensure it is public and correct: " + err.Error()})
		return
	}

	repo := models.Repository{
		UserID:        userID,
		Name:          repoName,
		Owner:         owner,
		URL:           req.URL,
		DefaultBranch: meta.DefaultBranch,
		Status:        "pending",
	}

	if err := h.db.Create(&repo).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Database write failed"})
		return
	}

	// Enqueue background indexing job
	h.worker.Enqueue(repo.ID)

	c.JSON(http.StatusAccepted, repo)
}

func (h *Handler) HandleGetRepo(c *gin.Context) {
	userID := c.MustGet("user_id").(uint)
	idStr := c.Param("id")
	id, err := strconv.ParseUint(idStr, 10, 32)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid repository ID"})
		return
	}

	var repo models.Repository
	if err := h.db.Where("id = ? AND user_id = ?", id, userID).First(&repo).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Repository not found"})
		return
	}

	c.JSON(http.StatusOK, repo)
}

func (h *Handler) HandleDeleteRepo(c *gin.Context) {
	userID := c.MustGet("user_id").(uint)
	idStr := c.Param("id")
	id, err := strconv.ParseUint(idStr, 10, 32)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid repository ID"})
		return
	}

	var repo models.Repository
	if err := h.db.Where("id = ? AND user_id = ?", id, userID).First(&repo).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Repository not found"})
		return
	}

	// Delete from Qdrant
	err = h.vectorClient.DeletePointsByRepo("github_repo_chunks", repo.ID)
	if err != nil {
		slog.Error("Failed deleting vectors from Qdrant on repository delete", "repo_id", repo.ID, "error", err)
	}

	// Delete from Postgres (GORM Cascade deletes dependent sessions and messages)
	if err := h.db.Delete(&repo).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{"message": "Repository successfully deleted"})
}

// -----------------------------------------------------------------------------
// Chat Q&A Handlers
// -----------------------------------------------------------------------------

func (h *Handler) HandleCreateSession(c *gin.Context) {
	userID := c.MustGet("user_id").(uint)

	var req struct {
		RepositoryID uint `json:"repository_id"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid body"})
		return
	}

	var repo models.Repository
	if err := h.db.Where("id = ? AND user_id = ?", req.RepositoryID, userID).First(&repo).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Repository not found"})
		return
	}

	session := models.ChatSession{
		UserID:       userID,
		RepositoryID: repo.ID,
		Title:        fmt.Sprintf("Chat about %s/%s", repo.Owner, repo.Name),
	}

	if err := h.db.Create(&session).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Database error"})
		return
	}

	c.JSON(http.StatusOK, session)
}

func (h *Handler) HandleListSessions(c *gin.Context) {
	userID := c.MustGet("user_id").(uint)
	var sessions []models.ChatSession
	if err := h.db.Preload("Repository").Where("user_id = ?", userID).Order("updated_at desc").Find(&sessions).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, sessions)
}

func (h *Handler) HandleGetSession(c *gin.Context) {
	userID := c.MustGet("user_id").(uint)
	sessionIDStr := c.Param("id")
	sessionID, err := uuid.Parse(sessionIDStr)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid session ID"})
		return
	}

	var session models.ChatSession
	if err := h.db.Preload("Repository").Where("id = ? AND user_id = ?", sessionID, userID).First(&session).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Session not found"})
		return
	}

	var messages []models.Message
	if err := h.db.Where("chat_session_id = ?", sessionID).Order("created_at asc").Find(&messages).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	// Build user-facing response with parsed citations
	type MessageWithCitations struct {
		models.Message
		Citations []models.Citation `json:"citations"`
	}

	messagesFormatted := make([]MessageWithCitations, len(messages))
	for i, m := range messages {
		var citations []models.Citation
		if m.CitationsRaw != "" {
			json.Unmarshal([]byte(m.CitationsRaw), &citations)
		}
		if citations == nil {
			citations = []models.Citation{}
		}
		messagesFormatted[i] = MessageWithCitations{
			Message:   m,
			Citations: citations,
		}
	}

	c.JSON(http.StatusOK, gin.H{
		"session":  session,
		"messages": messagesFormatted,
	})
}

func (h *Handler) HandleSendMessageStream(c *gin.Context) {
	userID := c.MustGet("user_id").(uint)
	sessionIDStr := c.Param("id")
	sessionID, err := uuid.Parse(sessionIDStr)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid session ID"})
		return
	}

	var session models.ChatSession
	if err := h.db.Preload("Repository").Where("id = ? AND user_id = ?", sessionID, userID).First(&session).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Session not found"})
		return
	}

	var req struct {
		Content string `json:"content"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid request content"})
		return
	}

	// Verify repository status before generating embedding
	if session.Repository.Status != "indexed" {
		errMsg := "Repository is not ready for chat."
		if session.Repository.ErrorMessage != "" {
			errMsg = fmt.Sprintf("Repository indexing failed: %s", session.Repository.ErrorMessage)
		} else if session.Repository.Status == "indexing" || session.Repository.Status == "pending" {
			errMsg = "Repository is currently being indexed. Please wait."
		}
		c.JSON(http.StatusBadRequest, gin.H{"error": errMsg})
		return
	}
	if session.Repository.ChunkCount == 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Repository contains no indexed code chunks. Please re-index the repository."})
		return
	}

	ctx := c.Request.Context()

	// 1. Generate Embedding for user's question
	slog.Info("Generating question embedding", "question", req.Content)
	questionVector, err := h.aiSvc.GetEmbedding(ctx, req.Content)
	if err != nil {
		errStr := err.Error()
		friendlyErr := "Failed generating query vector: " + errStr
		if strings.Contains(errStr, "insufficient_quota") || strings.Contains(errStr, "quota") {
			friendlyErr = "Your AI API key has run out of credits or quota. Please update your API key in .env"
		} else if strings.Contains(errStr, "invalid_api_key") || strings.Contains(errStr, "401") {
			friendlyErr = "The configured AI API key is invalid. Please verify your environment variables."
		}
		c.JSON(http.StatusBadRequest, gin.H{"error": friendlyErr})
		return
	}

	// 2. Perform Qdrant vector similarity search
	slog.Info("Searching vector DB", "repo_id", session.RepositoryID)
	hits, err := h.vectorClient.Search("github_repo_chunks", questionVector, session.RepositoryID, 5)
	if err != nil {
		slog.Error("Qdrant search error", "error", err)
	}

	// 3. Assemble Context & Citations list
	var contextParts []string
	var citations []models.Citation
	seenFiles := make(map[string]bool)

	for _, hit := range hits {
		contextParts = append(contextParts, fmt.Sprintf("File: %s (Lines %d-%d):\n%s\n---",
			hit.Payload.FilePath, hit.Payload.StartLine, hit.Payload.EndLine, hit.Payload.Content))

		// Form GitHub URL: e.g. https://github.com/owner/repo/blob/main/path/to/file.go#L10-L20
		refURL := fmt.Sprintf("%s/blob/%s/%s#L%d-L%d",
			strings.TrimSuffix(session.Repository.URL, ".git"),
			session.Repository.DefaultBranch,
			hit.Payload.FilePath,
			hit.Payload.StartLine,
			hit.Payload.EndLine,
		)

		citationKey := fmt.Sprintf("%s:%d-%d", hit.Payload.FilePath, hit.Payload.StartLine, hit.Payload.EndLine)
		if !seenFiles[citationKey] {
			seenFiles[citationKey] = true
			citations = append(citations, models.Citation{
				FilePath:  hit.Payload.FilePath,
				StartLine: hit.Payload.StartLine,
				EndLine:   hit.Payload.EndLine,
				URL:       refURL,
			})
		}
	}

	contextStr := strings.Join(contextParts, "\n\n")

	// 4. Retrieve chat history (limit to last 6 messages for context sizing)
	var history []models.Message
	h.db.Where("chat_session_id = ?", sessionID).Order("created_at desc").Limit(6).Find(&history)

	// Reverse history to chronological order
	chronHistory := make([]models.Message, len(history))
	for i := range history {
		chronHistory[i] = history[len(history)-1-i]
	}

	// 5. Construct grounding system prompt
	systemPrompt := fmt.Sprintf(`You are an expert developer assistant trained to explain the repository: %s/%s.
You must answer the user's question using the provided context from the codebase.
Strictly adhere to the following rules:
1. Rely ONLY on the provided Context to answer. If the answer cannot be found in the context, say "I cannot find details in the indexed repository." Do not make up answers.
2. Ground all claims by citing files and lines using markdown link format: [file_path](https://github.com/%s/%s/blob/%s/file_path#Lstart-Lend).
3. Do not include plain text file paths; always format them as clickable Markdown links.
4. Respond in clear, professional markdown. Use code blocks with language indicators.

Context:
%s`, session.Repository.Owner, session.Repository.Name,
		session.Repository.Owner, session.Repository.Name, session.Repository.DefaultBranch,
		contextStr)

	// Save User Message to database
	userMsg := models.Message{
		ChatSessionID: sessionID,
		Role:          "user",
		Content:       req.Content,
	}
	h.db.Create(&userMsg)

	// 6. Request streaming from AI Service
	slog.Info("Requesting streaming AI generation")
	streamChan, err := h.aiSvc.GenerateStream(ctx, systemPrompt, chronHistory, req.Content)
	if err != nil {
		errStr := err.Error()
		friendlyErr := "Failed initiating response stream: " + errStr
		if strings.Contains(errStr, "insufficient_quota") || strings.Contains(errStr, "quota") {
			friendlyErr = "Your AI API key has run out of credits or quota. Please update your API key in .env"
		} else if strings.Contains(errStr, "invalid_api_key") || strings.Contains(errStr, "401") {
			friendlyErr = "The configured AI API key is invalid. Please verify your environment variables."
		}
		c.JSON(http.StatusBadRequest, gin.H{"error": friendlyErr})
		return
	}

	// 7. Write SSE headers
	c.Header("Content-Type", "text/event-stream")
	c.Header("Cache-Control", "no-cache")
	c.Header("Connection", "keep-alive")
	c.Header("Transfer-Encoding", "chunked")

	var fullResponseBuilder strings.Builder

	c.Stream(func(w io.Writer) bool {
		select {
		case <-ctx.Done():
			slog.Info("SSE client disconnected")
			return false
		case chunk, ok := <-streamChan:
			if !ok {
				// Stream completed, write final packet with metadata and citations
				citationsBytes, _ := json.Marshal(citations)
				assistantMsg := models.Message{
					ChatSessionID: sessionID,
					Role:          "assistant",
					Content:       fullResponseBuilder.String(),
					CitationsRaw:  string(citationsBytes),
				}
				h.db.Create(&assistantMsg)

				// Update session timestamp
				h.db.Model(&session).Update("updated_at", time.Now())

				// Send final packet as metadata JSON
				finalMeta := map[string]interface{}{
					"message_id": assistantMsg.ID,
					"citations":  citations,
					"done":       true,
				}
				metaBytes, _ := json.Marshal(finalMeta)
				c.SSEvent("meta", string(metaBytes))
				return false
			}

			if chunk.Error != nil {
				slog.Error("Stream chunk error", "error", chunk.Error)
				c.SSEvent("error", chunk.Error.Error())
				return false
			}

			fullResponseBuilder.WriteString(chunk.Text)
			// Send text chunk to client
			c.SSEvent("text", chunk.Text)
			return true
		}
	})
}
