# GitMind 🧠

[![Go Version](https://img.shields.io/badge/Go-1.22+-00ADD8?style=flat-square&logo=go&logoColor=white)](https://go.dev/)
[![Next.js](https://img.shields.io/badge/Next.js-14+-000000?style=flat-square&logo=nextdotjs&logoColor=white)](https://nextjs.org/)
[![Qdrant](https://img.shields.io/badge/VectorDB-Qdrant-black?style=flat-square&logo=qdrant)](https://qdrant.tech/)
[![License](https://img.shields.io/badge/license-MIT-blue?style=flat-square)](LICENSE)

GitMind is an AI-powered codebase assistant that helps developers understand and navigate large or unfamiliar repositories instantly.

It uses a Retrieval-Augmented Generation (RAG) pipeline to index GitHub repositories, break them into semantic chunks, and provide context-aware answers in real time.

Built with a high-performance Go (Gin) backend and a modern Next.js dashboard, GitMind lets you paste a GitHub repository link, index it into a vector database, and chat directly with your codebase using Google Gemini models.

---

## 🚀 Key Features

- In-Memory ZIP Processing  
  Clones and processes repositories entirely in memory, removing disk I/O and keeping the system stateless.

- Sliding Window Chunking  
  Splits code into 30-line chunks with 8-line overlap to preserve context across boundaries.

- Self-Healing Vector Store  
  Automatically recreates Qdrant collections if embedding dimensions change or mismatch.

- Real-Time Streaming (SSE)  
  Streams LLM responses instantly to the frontend using Server-Sent Events.

- Hybrid Database Design  
  Uses PostgreSQL for structured data (users, repos, chats) and Qdrant for vector search.

---

## 🛠️ Tech Stack

- Backend: Go (Golang), Gin, GORM  
- Frontend: Next.js, TypeScript, Tailwind CSS  
- Vector DB: Qdrant  
- Database & Cache: PostgreSQL, Redis  
- AI Models: Google Gemini (`gemini-embedding-001`, `gemini-2.5`)

---

## ⚡ Quick Start

### 1. Environment Variables

Create a `.env` file in the root directory:

```env
PORT=8082
JWT_SECRET=your_super_secret_jwt_key
DEVELOPER_MODE=true

# Databases
DATABASE_URL=postgres://postgres:postgres@postgres:5435/gitmind?sslmode=disable
REDIS_URL=redis:6379

# AI & Integrations
GEMINI_API_KEY=your_google_gemini_api_key
OPENAI_API_KEY=your_openai_api_key
GITHUB_TOKEN=your_github_personal_access_token
```
### 2. Run with Docker
docker-compose up --build

🌐 Access Points
```
Frontend Dashboard: http://localhost:3000
Backend API: http://localhost:8082
```

---

## 💡 Why This Project Matters

Modern software systems are becoming increasingly large and complex, making it difficult for developers to quickly understand unfamiliar codebases. GitMind solves this problem by turning any GitHub repository into an interactive, conversational knowledge system.

Instead of manually searching through thousands of lines of code, developers can simply ask questions in natural language and get precise, context-aware answers grounded in the actual source code.

This project demonstrates how Retrieval-Augmented Generation (RAG), vector databases, and modern distributed systems can be combined to create practical developer tools that significantly improve productivity, onboarding speed, and code comprehension.

GitMind is not just a chatbot — it is a step toward AI-native software engineering workflows where understanding code becomes instant and interactive.


## 📄 License

This project is licensed under the MIT License.
