package ai

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"strings"
	"time"

	"github-assistant/backend/internal/models"
	"google.golang.org/genai"
)

type StreamResult struct {
	Text  string
	Error error
}

type AIService interface {
	GetEmbedding(ctx context.Context, text string) ([]float32, error)
	GenerateStream(ctx context.Context, systemPrompt string, chatHistory []models.Message, question string) (<-chan StreamResult, error)
	GetModelName() string
	GetVectorDimension() int
}

type GeminiService struct {
	apiKey string
	client *genai.Client
	model  string
}

func NewGeminiService(apiKey string) *GeminiService {
	client, err := genai.NewClient(context.Background(), &genai.ClientConfig{
		Backend: genai.BackendGeminiAPI,
		APIKey:  apiKey,
	})
	if err != nil {
		slog.Error("Failed to initialize Google GenAI Client", "error", err)
	}

	return &GeminiService{
		apiKey: apiKey,
		client: client,
		model:  "gemini-3-flash-preview",
	}
}

func (g *GeminiService) GetModelName() string {
	return g.model
}

func (g *GeminiService) GetVectorDimension() int {
	return 3072 // gemini-embedding-2 dimension
}

func (g *GeminiService) GetEmbedding(ctx context.Context, text string) ([]float32, error) {
	if g.client == nil {
		return nil, fmt.Errorf("gemini GenAI client is not initialized")
	}

	resp, err := g.client.Models.EmbedContent(ctx, "gemini-embedding-2", genai.Text(text), nil)
	if err != nil {
		return nil, fmt.Errorf("gemini embedding error: %w", err)
	}

	if len(resp.Embeddings) == 0 || resp.Embeddings[0].Values == nil {
		return nil, fmt.Errorf("gemini returned empty embedding values")
	}

	return resp.Embeddings[0].Values, nil
}

func (g *GeminiService) GenerateStream(ctx context.Context, systemPrompt string, chatHistory []models.Message, question string) (<-chan StreamResult, error) {
	if g.client == nil {
		return nil, fmt.Errorf("gemini GenAI client is not initialized")
	}

	var contents []*genai.Content

	// Map history
	for _, msg := range chatHistory {
		role := "user"
		if msg.Role == "assistant" {
			role = "model"
		}
		contents = append(contents, &genai.Content{
			Role: role,
			Parts: []*genai.Part{
				{
					Text: msg.Content,
				},
			},
		})
	}

	// Add final user query
	contents = append(contents, &genai.Content{
		Role: "user",
		Parts: []*genai.Part{
			{
				Text: question,
			},
		},
	})

	// Configure GenerateContentConfig
	config := &genai.GenerateContentConfig{
		SystemInstruction: &genai.Content{
			Parts: []*genai.Part{
				{
					Text: systemPrompt,
				},
			},
		},
		Temperature: genai.Ptr[float32](0.2),
	}

	// Request stream
	seq := g.client.Models.GenerateContentStream(ctx, g.model, contents, config)

	outChan := make(chan StreamResult, 100)

	go func() {
		defer close(outChan)
		for resp, err := range seq {
			if err != nil {
				outChan <- StreamResult{Error: err}
				break
			}
			text := resp.Text()
			if text != "" {
				outChan <- StreamResult{Text: text}
			}
		}
	}()

	return outChan, nil
}

type OpenAIService struct {
	apiKey string
}

func NewOpenAIService(apiKey string) *OpenAIService {
	return &OpenAIService{apiKey: apiKey}
}

func (o *OpenAIService) GetModelName() string {
	return "gpt-4o-mini"
}

func (o *OpenAIService) GetVectorDimension() int {
	return 1536 // text-embedding-3-small dimension
}

func (o *OpenAIService) GetEmbedding(ctx context.Context, text string) ([]float32, error) {
	url := "https://api.openai.com/v1/embeddings"

	reqBody, err := json.Marshal(map[string]interface{}{
		"model": "text-embedding-3-small",
		"input": text,
	})
	if err != nil {
		return nil, err
	}

	req, err := http.NewRequestWithContext(ctx, "POST", url, bytes.NewBuffer(reqBody))
	if err != nil {
		return nil, err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+o.apiKey)

	client := &http.Client{Timeout: 15 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		bodyBytes, _ := io.ReadAll(resp.Body)
		return nil, fmt.Errorf("openai embedding API error: status %d, body: %s", resp.StatusCode, string(bodyBytes))
	}

	var result struct {
		Data []struct {
			Embedding []float32 `json:"embedding"`
		} `json:"data"`
	}

	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return nil, err
	}

	if len(result.Data) == 0 {
		return nil, fmt.Errorf("openai returned empty embedding")
	}

	return result.Data[0].Embedding, nil
}

func (o *OpenAIService) GenerateStream(ctx context.Context, systemPrompt string, chatHistory []models.Message, question string) (<-chan StreamResult, error) {
	url := "https://api.openai.com/v1/chat/completions"

	var messages []map[string]interface{}
	messages = append(messages, map[string]interface{}{
		"role":    "system",
		"content": systemPrompt,
	})

	for _, msg := range chatHistory {
		messages = append(messages, map[string]interface{}{
			"role":    msg.Role,
			"content": msg.Content,
		})
	}

	messages = append(messages, map[string]interface{}{
		"role":    "user",
		"content": question,
	})

	reqBody, err := json.Marshal(map[string]interface{}{
		"model":       "gpt-4o-mini",
		"messages":    messages,
		"temperature": 0.2,
		"stream":      true,
	})
	if err != nil {
		return nil, err
	}

	req, err := http.NewRequestWithContext(ctx, "POST", url, bytes.NewBuffer(reqBody))
	if err != nil {
		return nil, err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+o.apiKey)

	client := &http.Client{}
	resp, err := client.Do(req)
	if err != nil {
		return nil, err
	}

	if resp.StatusCode != http.StatusOK {
		bodyBytes, _ := io.ReadAll(resp.Body)
		resp.Body.Close()
		return nil, fmt.Errorf("openai chat API error: status %d, body: %s", resp.StatusCode, string(bodyBytes))
	}

	outChan := make(chan StreamResult, 100)

	go func() {
		defer resp.Body.Close()
		defer close(outChan)

		reader := bufio.NewReader(resp.Body)
		for {
			line, err := reader.ReadString('\n')
			if err != nil {
				if err != io.EOF {
					outChan <- StreamResult{Error: err}
				}
				return
			}

			line = strings.TrimSpace(line)
			if line == "" {
				continue
			}

			if !strings.HasPrefix(line, "data: ") {
				continue
			}

			dataStr := strings.TrimPrefix(line, "data: ")
			if dataStr == "[DONE]" {
				return
			}

			var chunk struct {
				Choices []struct {
					Delta struct {
						Content string `json:"content"`
					} `json:"delta"`
				} `json:"choices"`
			}

			if err := json.Unmarshal([]byte(dataStr), &chunk); err != nil {
				outChan <- StreamResult{Error: err}
				return
			}

			if len(chunk.Choices) > 0 && chunk.Choices[0].Delta.Content != "" {
				outChan <- StreamResult{Text: chunk.Choices[0].Delta.Content}
			}
		}
	}()

	return outChan, nil
}
