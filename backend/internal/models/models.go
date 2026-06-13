package models

import (
	"time"

	"github.com/google/uuid"
	"gorm.io/gorm"
)

type User struct {
	ID        uint           `gorm:"primaryKey" json:"id"`
	Email     string         `gorm:"uniqueIndex;not null" json:"email"`
	Name      string         `json:"name"`
	AvatarURL string         `json:"avatar_url"`
	CreatedAt time.Time      `json:"created_at"`
	UpdatedAt time.Time      `json:"updated_at"`
	DeletedAt gorm.DeletedAt `gorm:"index" json:"-"`
}

type Repository struct {
	ID            uint           `gorm:"primaryKey" json:"id"`
	UserID        uint           `gorm:"not null" json:"user_id"`
	Name          string         `gorm:"not null" json:"name"`
	Owner         string         `gorm:"not null" json:"owner"`
	URL           string         `gorm:"not null" json:"url"`
	DefaultBranch string         `gorm:"default:'main'" json:"default_branch"`
	Status        string         `gorm:"default:'pending'" json:"status"` // pending, indexing, indexed, failed
	ErrorMessage  string         `json:"error_message"`
	ChunkCount    int            `gorm:"default:0" json:"chunk_count"`
	CreatedAt     time.Time      `json:"created_at"`
	UpdatedAt     time.Time      `json:"updated_at"`
	DeletedAt     gorm.DeletedAt `gorm:"index" json:"-"`
}

type ChatSession struct {
	ID           uuid.UUID      `gorm:"type:uuid;primaryKey" json:"id"`
	UserID       uint           `gorm:"not null" json:"user_id"`
	RepositoryID uint           `gorm:"not null" json:"repository_id"`
	Title        string         `gorm:"not null" json:"title"`
	CreatedAt    time.Time      `json:"created_at"`
	UpdatedAt    time.Time      `json:"updated_at"`
	DeletedAt    gorm.DeletedAt `gorm:"index" json:"-"`

	Repository   Repository     `gorm:"foreignKey:RepositoryID" json:"repository,omitempty"`
}

type Citation struct {
	FilePath  string `json:"file_path"`
	StartLine int    `json:"start_line"`
	EndLine   int    `json:"end_line"`
	URL       string `json:"url"`
}

type Message struct {
	ID            uint      `gorm:"primaryKey" json:"id"`
	ChatSessionID uuid.UUID `gorm:"type:uuid;not null;index" json:"chat_session_id"`
	Role          string    `gorm:"not null" json:"role"` // user, assistant
	Content       string    `gorm:"type:text;not null" json:"content"`
	CitationsRaw  string    `gorm:"type:text;column:citations" json:"-"` // JSON string of citations
	CreatedAt     time.Time `json:"created_at"`
}

// BeforeCreate hook to generate UUIDs
func (cs *ChatSession) BeforeCreate(tx *gorm.DB) error {
	if cs.ID == uuid.Nil {
		cs.ID = uuid.New()
	}
	return nil
}
