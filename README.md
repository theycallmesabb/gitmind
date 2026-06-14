# GitMind 🧠

[![Go Version](https://img.shields.io/badge/Go-1.22+-00ADD8?style=flat-square&logo=go&logoColor=white)](https://go.dev/)
[![Next.js Version](https://img.shields.io/badge/Next.js-14+-000000?style=flat-square&logo=nextdotjs&logoColor=white)](https://nextjs.org/)
[![Qdrant](https://img.shields.io/badge/VectorDB-Qdrant-black?style=flat-square&logo=qdrant)](https://qdrant.tech/)
[![License](https://img.shields.io/badge/license-MIT-blue?style=flat-square)](LICENSE)

GitMind is a stateless, production-ready, AI-powered codebase assistant. It leverages a **Retrieval-Augmented Generation (RAG)** pipeline to index repository architectures, parse file content into line-based semantic chunks, calculate vector embeddings, and supply context-grounded answers in real-time. 

Built with a high-performance **Go/Gin** backend and a sleek **Next.js** dashboard, GitMind allows developers to point to any GitHub repository, index it instantly, and chat with the codebase locally using **Google Gemini**.

---

## 🚀 Key Features

*   **In-Memory Processing:** Downloads and parses repository ZIP archives fully in-memory to maintain absolute statelessness—no cloning to local disks.
*   **Line-Based Sliding-Window Chunking:** Intelligent 30-line segmentation with an 8-line overlap to preserve syntactic scope across chunk boundaries.
*   **Self-Healing Vector Collection:** Automatically detects and repairs vector dimension mismatches (e.g., migrating legacy 768-dim models to Gemini's 3072-dim space).
*   **Real-Time SSE Streaming:** Low-latency token streaming from backend to client using native Server-Sent Events over standard HTTP.
*   **Dual-Layer Storage:** PostgreSQL handles metadata, relations, and transactional state, while Qdrant tackles high-dimensional semantic search.

---

## 🏗️ System Architecture

GitMind splits workloads between a highly concurrent Go backend engine and an optimized TypeScript/Next.js interface.

### Component Topology
