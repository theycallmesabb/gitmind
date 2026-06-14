# GitMind 🧠

[![Go Version](https://img.shields.io/badge/Go-1.22+-00ADD8?style=flat-square&logo=go&logoColor=white)](https://go.dev/)
[![Next.js Version](https://img.shields.io/badge/Next.js-14+-000000?style=flat-square&logo=nextdotjs&logoColor=white)](https://nextjs.org/)
[![Qdrant](https://img.shields.io/badge/VectorDB-Qdrant-black?style=flat-square&logo=qdrant)](https://qdrant.tech/)
[![License](https://img.shields.io/badge/license-MIT-blue?style=flat-square)](LICENSE)

GitMind is a stateless, production-ready, AI-powered codebase assistant. It leverages a **Retrieval-Augmented Generation (RAG)** pipeline to index repository architectures, parse file content into line-based semantic chunks, calculate vector embeddings, and supply context-grounded answers in real-time. 

Built with a high-performance **Go/Gin** backend and a sleek **Next.js** dashboard, GitMind allows developers to point to any GitHub repository, index it instantly, and chat with the codebase locally using **Google Gemini**. Complete architectural specifications and operational guidelines can be referenced verbatim in the **complete_project_guide.md** file.

---

## 🚀 Key Features

*   **In-Memory Processing:** Downloads and parses repository ZIP archives fully in-memory to maintain absolute statelessness—avoiding the disk overhead of local shell commands.
*   **Line-Based Sliding-Window Chunking:** Intelligent 30-line segmentation with an 8-line overlap to preserve syntactic scope and variable context across chunk boundaries[cite: 1].
*   **Self-Healing Vector Collection:** Automatically detects and repairs vector dimension mismatches, ensuring seamless alignment between the codebase index and active models[cite: 1].
*   **Real-Time SSE Streaming:** Low-latency token streaming from backend to client using native Server-Sent Events over standard HTTP, offering streamlined authentication over WebSockets[cite: 1].
*   **Dual-Layer Storage:** PostgreSQL handles transactional application state, relations, and user profiles, while Qdrant tackles high-dimensional semantic search[cite: 1].

---

## 🏗️ Technical Pipeline & Concepts

### Retrieval-Augmented Generation (RAG)
Rather than executing expensive model fine-tuning, GitMind surfaces relevant source blocks from an external vector index based on user intent and injects them straight into the LLM context window alongside the prompt[cite: 1]. This ensures responses remain deterministic, verifiable, and anchored to factual code implementations[cite: 1].

### Vector Space Math
Text fragments are processed by embedding models (such as `gemini-embedding-001`) into fixed-length floating-point arrays across high-dimensional spaces[cite: 1]. Document relevancy is determined via Cosine Similarity, measuring the exact geometric angle between a query vector $\vec{Q}$ and document vector $\vec{D}$[cite: 1]:

$$\text{Sim}(\vec{Q}, \vec{D}) = \cos(\theta) = \frac{\vec{Q} \cdot \vec{D}}{\|\vec{Q}\| \|\vec{D}\|} = \frac{\sum_{i=1}^{n} Q_i D_i}{\sqrt{\sum_{i=1}^{n} Q_i^2} \sqrt{\sum_{i=1}^{n} D_i^2}}$$

### Concurrency Architecture
Ingestion jobs are powered by Go’s native Communicating Sequential Processes (CSP) framework[cite: 1]. Lightweight goroutines pass computational tokens securely across typed channels into an active, resource-bounded Worker Pool[cite: 1]. This system architecture protects memory footprints and mitigates systemic thread exhaustion during massive codebase extraction events[cite: 1].

---
