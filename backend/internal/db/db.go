package db

import (
	"log/slog"

	"github-assistant/backend/internal/models"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
)

func InitDB(databaseURL string) (*gorm.DB, error) {
	slog.Info("Connecting to database...", "url", databaseURL)
	db, err := gorm.Open(postgres.Open(databaseURL), &gorm.Config{})
	if err != nil {
		return nil, err
	}

	slog.Info("Running migrations...")
	err = db.AutoMigrate(
		&models.User{},
		&models.Repository{},
		&models.ChatSession{},
		&models.Message{},
	)
	if err != nil {
		return nil, err
	}

	slog.Info("Database migrations successfully run.")
	return db, nil
}
