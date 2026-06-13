const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8080';

export interface User {
  id: number;
  email: string;
  name: string;
  avatar_url: string;
}

export interface Repository {
  id: number;
  user_id: number;
  name: string;
  owner: string;
  url: string;
  default_branch: string;
  status: 'pending' | 'indexing' | 'indexed' | 'failed';
  error_message: string;
  chunk_count: number;
  created_at: string;
  updated_at: string;
}

export interface ChatSession {
  id: string;
  user_id: number;
  repository_id: number;
  title: string;
  created_at: string;
  updated_at: string;
  repository?: Repository;
}

export interface Citation {
  file_path: string;
  start_line: number;
  end_line: number;
  url: string;
}

export interface Message {
  id: number;
  chat_session_id: string;
  role: 'user' | 'assistant';
  content: string;
  citations: Citation[];
  created_at: string;
}

function getHeaders(): HeadersInit {
  const token = typeof window !== 'undefined' ? localStorage.getItem('gitmind') : null;
  const headers: HeadersInit = {
    'Content-Type': 'application/json',
  };
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }
  return headers;
}

export async function devLogin(email: string, name: string): Promise<{ token: string; user: User }> {
  const res = await fetch(`${API_BASE}/api/auth/dev-login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, name }),
  });
  if (!res.ok) {
    throw new Error('Failed to login via Developer mode');
  }
  const data = await res.json();
  localStorage.setItem('gitmind', data.token);
  return data;
}

export async function getProfile(): Promise<User> {
  const res = await fetch(`${API_BASE}/api/auth/profile`, {
    headers: getHeaders(),
  });
  if (!res.ok) {
    throw new Error('Failed to fetch user profile');
  }
  return res.json();
}

export async function listRepos(): Promise<Repository[]> {
  const res = await fetch(`${API_BASE}/api/repos`, {
    headers: getHeaders(),
  });
  if (!res.ok) {
    throw new Error('Failed to fetch repositories');
  }
  return res.json();
}

export async function createRepo(url: string): Promise<Repository> {
  const res = await fetch(`${API_BASE}/api/repos`, {
    method: 'POST',
    headers: getHeaders(),
    body: JSON.stringify({ url }),
  });
  if (!res.ok) {
    const errorData = await res.json();
    throw new Error(errorData.error || 'Failed adding repository');
  }
  return res.json();
}

export async function getRepo(id: number): Promise<Repository> {
  const res = await fetch(`${API_BASE}/api/repos/${id}`, {
    headers: getHeaders(),
  });
  if (!res.ok) {
    throw new Error('Failed to fetch repository status');
  }
  return res.json();
}

export async function deleteRepo(id: number): Promise<void> {
  const res = await fetch(`${API_BASE}/api/repos/${id}`, {
    method: 'DELETE',
    headers: getHeaders(),
  });
  if (!res.ok) {
    throw new Error('Failed to delete repository');
  }
}

export async function listSessions(): Promise<ChatSession[]> {
  const res = await fetch(`${API_BASE}/api/chat/sessions`, {
    headers: getHeaders(),
  });
  if (!res.ok) {
    throw new Error('Failed to load chat sessions');
  }
  return res.json();
}

export async function createSession(repositoryId: number): Promise<ChatSession> {
  const res = await fetch(`${API_BASE}/api/chat/sessions`, {
    method: 'POST',
    headers: getHeaders(),
    body: JSON.stringify({ repository_id: repositoryId }),
  });
  if (!res.ok) {
    throw new Error('Failed to start chat session');
  }
  return res.json();
}

export async function getSession(id: string): Promise<{ session: ChatSession; messages: Message[] }> {
  const res = await fetch(`${API_BASE}/api/chat/sessions/${id}`, {
    headers: getHeaders(),
  });
  if (!res.ok) {
    throw new Error('Failed to load chat session details');
  }
  return res.json();
}

export async function sendMessageStream(
  sessionId: string,
  content: string,
  onChunk: (text: string) => void,
  onMeta: (data: { message_id: number; citations: Citation[] }) => void,
  onError: (err: string) => void
): Promise<void> {
  const token = localStorage.getItem('gitmind');
  try {
    const response = await fetch(`${API_BASE}/api/chat/sessions/${sessionId}/message`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': token ? `Bearer ${token}` : '',
      },
      body: JSON.stringify({ content }),
    });

    if (!response.ok) {
      let errMsg = response.statusText;
      try {
        const errJson = await response.json();
        if (errJson && errJson.error) {
          errMsg = errJson.error;
        }
      } catch (e) {
        // ignore
      }
      throw new Error(errMsg);
    }

    const reader = response.body?.getReader();
    if (!reader) {
      throw new Error('Response body reader not available');
    }

    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { value, done } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });

      // SSE lines are separated by double newlines or single newlines
      const lines = buffer.split('\n');
      buffer = lines.pop() || ''; // Keep the last incomplete line in buffer

      let currentEvent = '';

      for (const line of lines) {
        const trimmed = line.trim();
        if (trimmed === '') continue;

        if (trimmed.startsWith('event:')) {
          currentEvent = trimmed.replace('event:', '').trim();
        } else if (trimmed.startsWith('data:')) {
          const dataContent = trimmed.replace('data:', '').trim();

          if (currentEvent === 'text') {
            onChunk(dataContent);
          } else if (currentEvent === 'meta') {
            try {
              const metaData = JSON.parse(dataContent);
              onMeta(metaData);
            } catch (e) {
              console.error('Failed parsing citation metadata', e);
            }
          } else if (currentEvent === 'error') {
            onError(dataContent);
          }
        }
      }
    }
  } catch (error: any) {
    onError(error.message || 'Network stream error');
  }
}
