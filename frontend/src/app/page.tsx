'use client';

import React, { useState, useEffect, useRef } from 'react';
import { 
  Github, 
  MessageSquare, 
  Plus, 
  Trash2, 
  LogOut, 
  ExternalLink, 
  Database, 
  AlertTriangle, 
  CheckCircle2, 
  Loader2, 
  Send, 
  Sparkles, 
  BookOpen, 
  ArrowRight, 
  FileText, 
  Code2, 
  Info,
  Layers
} from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import * as api from '@/lib/api';

export default function Home() {
  // Authentication State
  const [token, setToken] = useState<string | null>(null);
  const [user, setUser] = useState<api.User | null>(null);
  const [devEmail, setDevEmail] = useState('');
  const [devName, setDevName] = useState('');
  const [authError, setAuthError] = useState('');
  const [authLoading, setAuthLoading] = useState(false);

  // Application Data State
  const [repos, setRepos] = useState<api.Repository[]>([]);
  const [sessions, setSessions] = useState<api.ChatSession[]>([]);
  const [selectedSession, setSelectedSession] = useState<api.ChatSession | null>(null);
  const [messages, setMessages] = useState<api.Message[]>([]);
  
  // Input Forms State
  const [repoURL, setRepoURL] = useState('');
  const [chatInput, setChatInput] = useState('');
  const [addRepoError, setAddRepoError] = useState('');
  const [addRepoLoading, setAddRepoLoading] = useState(false);
  const [chatLoading, setChatLoading] = useState(false);
  const [streamingText, setStreamingText] = useState('');
  
  // UI Panels / Navigation
  const [activeTab, setActiveTab] = useState<'dashboard' | 'chat'>('dashboard');

  const messagesEndRef = useRef<HTMLDivElement>(null);

  // 1. Initial Load and Auth check
  useEffect(() => {
    const savedToken = localStorage.getItem('gitmind');
    if (savedToken) {
      setToken(savedToken);
      fetchUserData();
    }
  }, []);

  // Poll indexing repositories status
  useEffect(() => {
    if (!token) return;

    const interval = setInterval(() => {
      const indexingRepos = repos.filter(r => r.status === 'indexing' || r.status === 'pending');
      if (indexingRepos.length > 0) {
        loadRepositories();
      }
    }, 4000);

    return () => clearInterval(interval);
  }, [repos, token]);

  const fetchUserData = async () => {
    try {
      const u = await api.getProfile();
      setUser(u);
      loadRepositories();
      loadSessions();
    } catch (err) {
      handleLogout();
    }
  };

  const loadRepositories = async () => {
    try {
      const data = await api.listRepos();
      setRepos(data);
    } catch (err) {
      console.error(err);
    }
  };

  const loadSessions = async () => {
    try {
      const data = await api.listSessions();
      setSessions(data);
    } catch (err) {
      console.error(err);
    }
  };

  // 2. Authentication handlers
  const handleDevLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!devEmail.trim()) {
      setAuthError('Email is required');
      return;
    }
    setAuthLoading(true);
    setAuthError('');
    try {
      const res = await api.devLogin(devEmail, devName || 'Developer');
      setToken(res.token);
      setUser(res.user);
      loadRepositories();
      loadSessions();
    } catch (err: any) {
      setAuthError(err.message || 'Login failed');
    } finally {
      setAuthLoading(false);
    }
  };

  const handleGoogleLogin = () => {
    window.location.href = 'http://localhost:8080/api/auth/login/google';
  };

  const handleLogout = () => {
    localStorage.removeItem('gitmind');
    setToken(null);
    setUser(null);
    setRepos([]);
    setSessions([]);
    setSelectedSession(null);
    setMessages([]);
    setActiveTab('dashboard');
  };

  // 3. Repository Handlers
  const handleAddRepo = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!repoURL.trim()) return;
    
    setAddRepoLoading(true);
    setAddRepoError('');
    try {
      await api.createRepo(repoURL);
      setRepoURL('');
      loadRepositories();
    } catch (err: any) {
      setAddRepoError(err.message || 'Failed to add repository');
    } finally {
      setAddRepoLoading(false);
    }
  };

  const handleDeleteRepo = async (id: number, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!confirm('Are you sure you want to delete this repository? This will delete all indexed vectors and chat histories.')) return;
    try {
      await api.deleteRepo(id);
      if (selectedSession?.repository_id === id) {
        setSelectedSession(null);
        setMessages([]);
        setActiveTab('dashboard');
      }
      loadRepositories();
      loadSessions();
    } catch (err) {
      alert('Failed to delete repository');
    }
  };

  // 4. Chat Session Handlers
  const handleStartChat = async (repoId: number) => {
    try {
      const session = await api.createSession(repoId);
      loadSessions();
      handleSelectSession(session);
    } catch (err) {
      alert('Failed starting chat session');
    }
  };

  const handleSelectSession = async (session: api.ChatSession) => {
    setSelectedSession(session);
    setActiveTab('chat');
    setStreamingText('');
    try {
      const data = await api.getSession(session.id);
      setMessages(data.messages);
      setTimeout(scrollToBottom, 50);
    } catch (err) {
      alert('Failed loading session messages');
    }
  };

  // 5. Chat Communication Handlers
  const handleSendMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!chatInput.trim() || !selectedSession || chatLoading) return;

    const userQuery = chatInput;
    setChatInput('');
    setChatLoading(true);
    setStreamingText('');

    // Append User Message to UI instantly
    const tempUserMsg: api.Message = {
      id: Date.now(),
      chat_session_id: selectedSession.id,
      role: 'user',
      content: userQuery,
      citations: [],
      created_at: new Date().toISOString(),
    };
    setMessages(prev => [...prev, tempUserMsg]);
    setTimeout(scrollToBottom, 50);

    // Call SSE streaming
    await api.sendMessageStream(
      selectedSession.id,
      userQuery,
      (textChunk) => {
        setStreamingText(prev => prev + textChunk);
        scrollToBottom();
      },
      (meta) => {
        // Complete Streaming Process, fetch official history to sync DB ids and Citations
        setStreamingText('');
        syncSessionMessages(selectedSession.id);
      },
      (errorMsg) => {
        setChatLoading(false);
        alert('Chat error: ' + errorMsg);
      }
    );
  };

  const syncSessionMessages = async (sid: string) => {
    try {
      const data = await api.getSession(sid);
      setMessages(data.messages);
      setChatLoading(false);
      setTimeout(scrollToBottom, 100);
    } catch (e) {
      setChatLoading(false);
    }
  };

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  const handleSuggestionClick = (prompt: string) => {
    setChatInput(prompt);
  };

  // Formatting helpers
  const getInitials = (name: string) => {
    return name
      .split(' ')
      .map(n => n[0])
      .join('')
      .toUpperCase()
      .slice(0, 2);
  };

  const totalChunks = repos.reduce((acc, r) => acc + r.chunk_count, 0);

  // Render Login view if unauthenticated
  if (!token) {
    return (
      <div className="flex-1 flex flex-col justify-center items-center px-4 py-16 relative overflow-hidden">
        {/* Decorative background lights */}
        <div className="absolute top-1/4 left-1/4 w-96 h-96 bg-indigo-500/10 rounded-full blur-[120px] glow-glow"></div>
        <div className="absolute bottom-1/4 right-1/4 w-96 h-96 bg-cyan-500/10 rounded-full blur-[120px] glow-glow" style={{ animationDelay: '1.5s' }}></div>

        <div className="w-full max-w-md glass-panel-glow rounded-3xl p-8 space-y-8 relative z-10">
          <div className="text-center space-y-2">
            <div className="inline-flex p-3 bg-indigo-600/10 rounded-2xl border border-indigo-500/20 text-indigo-400 mb-2 animate-float">
              <Sparkles className="w-8 h-8" />
            </div>
            <h1 className="text-3xl font-extrabold tracking-tight bg-clip-text text-transparent bg-gradient-to-r from-white via-indigo-200 to-indigo-400">
              GitMind AI
            </h1>
            <p className="text-sm text-zinc-400">
              Retrieve, index, and chat with any GitHub repository
            </p>
          </div>

          {authError && (
            <div className="p-4 bg-red-950/30 border border-red-500/30 text-red-400 rounded-xl text-sm flex items-start gap-3">
              <AlertTriangle className="w-5 h-5 shrink-0" />
              <span>{authError}</span>
            </div>
          )}

          {/* Guest / Developer Login */}
          <form onSubmit={handleDevLogin} className="space-y-4">
            <div className="space-y-2">
              <label className="text-xs font-semibold text-zinc-400 uppercase tracking-wider block">
                Developer Mode Login
              </label>
              <input
                type="email"
                placeholder="developer@local.com"
                value={devEmail}
                onChange={e => setDevEmail(e.target.value)}
                className="w-full px-4 py-3 rounded-xl glass-input text-white text-sm focus:outline-none focus:ring-1 focus:ring-indigo-500"
              />
              <input
                type="text"
                placeholder="Developer Name (Optional)"
                value={devName}
                onChange={e => setDevName(e.target.value)}
                className="w-full px-4 py-3 rounded-xl glass-input text-white text-sm focus:outline-none focus:ring-1 focus:ring-indigo-500 mt-2"
              />
            </div>

            <button
              type="submit"
              disabled={authLoading}
              className="w-full py-3 bg-indigo-600 hover:bg-indigo-500 disabled:bg-indigo-800 text-white font-medium rounded-xl text-sm transition-all duration-200 flex items-center justify-center gap-2 cursor-pointer shadow-lg shadow-indigo-600/10"
            >
              {authLoading ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <>
                  <span>Enter as Guest</span>
                  <ArrowRight className="w-4 h-4" />
                </>
              )}
            </button>
          </form>

          <div className="relative flex items-center justify-center">
            <div className="absolute inset-0 flex items-center">
              <div className="w-full border-t border-zinc-800"></div>
            </div>
            <span className="relative px-3 bg-[#0c0c0e] text-xs text-zinc-500 uppercase tracking-wider font-medium">
              Or Connect With
            </span>
          </div>

          {/* Google login */}
          <button
            onClick={handleGoogleLogin}
            className="w-full py-3 bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 text-white text-sm font-medium rounded-xl transition-all duration-200 flex items-center justify-center gap-3 cursor-pointer"
          >
            <svg className="w-4 h-4" viewBox="0 0 24 24">
              <path
                fill="currentColor"
                d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
              />
              <path
                fill="currentColor"
                d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
              />
              <path
                fill="currentColor"
                d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z"
              />
              <path
                fill="currentColor"
                d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z"
              />
            </svg>
            <span>Google Workspace Login</span>
          </button>
        </div>
      </div>
    );
  }

  // Dashboard / Authenticated Workspace Layout
  return (
    <div className="flex-1 flex overflow-hidden h-screen bg-[#030303]">
      
      {/* 1. SIDEBAR */}
      <aside className="w-80 border-r border-zinc-800 bg-[#070709] flex flex-col h-full shrink-0">
        
        {/* Sidebar Header */}
        <div className="p-5 border-b border-zinc-900 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-indigo-600/10 rounded-xl border border-indigo-500/20 text-indigo-400">
              <Sparkles className="w-5 h-5 animate-pulse" />
            </div>
            <span className="font-bold text-lg text-white tracking-wide">GitMind AI</span>
          </div>
          <button
            onClick={() => {
              setSelectedSession(null);
              setMessages([]);
              setActiveTab('dashboard');
            }}
            className="p-1.5 rounded-lg border border-zinc-800 hover:bg-zinc-800 text-zinc-400 hover:text-white transition-all duration-200 cursor-pointer"
            title="Go to dashboard"
          >
            <Layers className="w-4 h-4" />
          </button>
        </div>

        {/* Add Repository Input */}
        <div className="p-4 border-b border-zinc-900">
          <form onSubmit={handleAddRepo} className="space-y-2">
            <div className="relative">
              <input
                type="text"
                placeholder="https://github.com/..."
                value={repoURL}
                onChange={e => setRepoURL(e.target.value)}
                className="w-full pl-3 pr-8 py-2 rounded-lg glass-input text-xs text-white focus:outline-none focus:ring-1 focus:ring-indigo-500"
              />
              <button
                type="submit"
                disabled={addRepoLoading || !repoURL}
                className="absolute right-1 top-1 bottom-1 px-1.5 bg-indigo-600 disabled:bg-zinc-800 text-white rounded hover:bg-indigo-500 transition-colors flex items-center justify-center cursor-pointer"
              >
                {addRepoLoading ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <Plus className="w-3.5 h-3.5" />
                )}
              </button>
            </div>
            {addRepoError && (
              <p className="text-[10px] text-red-400 bg-red-950/20 border border-red-500/20 p-1.5 rounded">
                {addRepoError}
              </p>
            )}
          </form>
        </div>

        {/* Sidebar Nav Content */}
        <div className="flex-1 overflow-y-auto px-3 py-4 space-y-6">
          
          {/* Tracked Repositories Section */}
          <div className="space-y-2">
            <span className="text-[10px] font-bold text-zinc-500 uppercase tracking-wider px-2 block">
              Tracked Repositories ({repos.length})
            </span>
            <div className="space-y-1">
              {repos.length === 0 ? (
                <p className="text-xs text-zinc-600 px-2 italic">No repositories added yet</p>
              ) : (
                repos.map(r => (
                  <div
                    key={r.id}
                    onClick={() => {
                      if (r.status === 'indexed') {
                        handleStartChat(r.id);
                      }
                    }}
                    className={`group w-full flex items-center justify-between p-2.5 rounded-lg text-left transition-all duration-200 cursor-pointer ${
                      selectedSession?.repository_id === r.id && activeTab === 'chat'
                        ? 'bg-indigo-950/30 border border-indigo-500/20 text-indigo-200'
                        : 'border border-transparent hover:bg-zinc-900/50 text-zinc-400 hover:text-zinc-200'
                    }`}
                  >
                    <div className="flex items-center gap-2.5 min-w-0 flex-1">
                      <Github className="w-4 h-4 shrink-0 opacity-70 group-hover:opacity-100" />
                      <div className="min-w-0 flex-1">
                        <p className="text-xs font-semibold truncate text-white leading-tight">
                          {r.name}
                        </p>
                        <p className="text-[10px] text-zinc-500 truncate leading-none mt-1">
                          {r.owner}
                        </p>
                      </div>
                    </div>
                    
                    {/* Status dot */}
                    <div className="flex items-center gap-1.5 shrink-0 ml-2">
                      {r.status === 'indexing' && (
                        <span className="relative flex h-2 w-2">
                          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-amber-400 opacity-75"></span>
                          <span className="relative inline-flex rounded-full h-2 w-2 bg-amber-500"></span>
                        </span>
                      )}
                      {r.status === 'pending' && (
                        <span className="h-2 w-2 rounded-full bg-zinc-700"></span>
                      )}
                      {r.status === 'indexed' && (
                        <span className="h-2 w-2 rounded-full bg-emerald-500"></span>
                      )}
                      {r.status === 'failed' && (
                        <span className="h-2 w-2 rounded-full bg-rose-500" title={r.error_message}></span>
                      )}
                      
                      <button
                        onClick={(e) => handleDeleteRepo(r.id, e)}
                        className="p-1 rounded opacity-0 group-hover:opacity-100 hover:bg-zinc-800 text-zinc-500 hover:text-red-400 transition-all cursor-pointer"
                        title="Remove Repository"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>

          {/* Active Chats Section */}
          <div className="space-y-2">
            <span className="text-[10px] font-bold text-zinc-500 uppercase tracking-wider px-2 block">
              Recent Conversations ({sessions.length})
            </span>
            <div className="space-y-1">
              {sessions.length === 0 ? (
                <p className="text-xs text-zinc-600 px-2 italic">No chats started yet</p>
              ) : (
                sessions.map(s => (
                  <button
                    key={s.id}
                    onClick={() => handleSelectSession(s)}
                    className={`w-full flex items-center gap-2.5 p-2.5 rounded-lg text-left transition-all duration-200 cursor-pointer ${
                      selectedSession?.id === s.id
                        ? 'bg-zinc-900 border border-zinc-800 text-white'
                        : 'border border-transparent hover:bg-zinc-900/50 text-zinc-400 hover:text-zinc-200'
                    }`}
                  >
                    <MessageSquare className="w-3.5 h-3.5 shrink-0" />
                    <span className="text-xs truncate flex-1">{s.title}</span>
                  </button>
                ))
              )}
            </div>
          </div>

        </div>

        {/* User profile footer */}
        {user && (
          <div className="p-4 border-t border-zinc-900 bg-[#0b0b0e] flex items-center justify-between">
            <div className="flex items-center gap-3 min-w-0">
              <div className="w-9 h-9 rounded-full bg-indigo-600 border border-indigo-500/30 flex items-center justify-center text-white font-bold text-xs shrink-0 overflow-hidden">
                {user.avatar_url ? (
                  <img src={user.avatar_url} alt={user.name} className="w-full h-full object-cover" />
                ) : (
                  getInitials(user.name)
                )}
              </div>
              <div className="min-w-0">
                <p className="text-xs font-semibold text-white truncate leading-tight">{user.name}</p>
                <p className="text-[10px] text-zinc-500 truncate mt-0.5">{user.email}</p>
              </div>
            </div>
            <button
              onClick={handleLogout}
              className="p-2 rounded-lg hover:bg-zinc-900 text-zinc-400 hover:text-red-400 transition-colors cursor-pointer"
              title="Logout"
            >
              <LogOut className="w-4 h-4" />
            </button>
          </div>
        )}
      </aside>

      {/* 2. MAIN VIEWPORT */}
      <main className="flex-1 flex flex-col h-full overflow-hidden bg-[#030303]">
        
        {/* A. DASHBOARD VIEW */}
        {activeTab === 'dashboard' && (
          <div className="flex-1 overflow-y-auto px-8 py-10 space-y-10 relative">
            <div className="max-w-4xl mx-auto space-y-8">
              
              {/* Header Title */}
              <div className="flex items-start justify-between border-b border-zinc-900 pb-6">
                <div>
                  <h1 className="text-3xl font-extrabold text-white">Developer Dashboard</h1>
                  <p className="text-sm text-zinc-400 mt-1">
                    Manage indexed sources, audit sizes, and chat context.
                  </p>
                </div>
                <div className="px-4 py-2 bg-indigo-600/10 border border-indigo-500/20 text-indigo-400 rounded-xl text-xs font-medium">
                  Status: Connected
                </div>
              </div>

              {/* Stats overview cards */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                <div className="p-6 rounded-2xl glass-panel border border-zinc-800 space-y-4">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-semibold text-zinc-400 uppercase tracking-wider block">
                      Repositories
                    </span>
                    <Github className="w-5 h-5 text-indigo-400" />
                  </div>
                  <div className="flex items-baseline gap-2">
                    <span className="text-3xl font-bold text-white">{repos.length}</span>
                    <span className="text-xs text-zinc-500">tracked</span>
                  </div>
                </div>

                <div className="p-6 rounded-2xl glass-panel border border-zinc-800 space-y-4">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-semibold text-zinc-400 uppercase tracking-wider block">
                      Total Context Chunks
                    </span>
                    <Database className="w-5 h-5 text-cyan-400" />
                  </div>
                  <div className="flex items-baseline gap-2">
                    <span className="text-3xl font-bold text-white">{totalChunks}</span>
                    <span className="text-xs text-zinc-500">vectors stored</span>
                  </div>
                </div>

                <div className="p-6 rounded-2xl glass-panel border border-zinc-800 space-y-4">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-semibold text-zinc-400 uppercase tracking-wider block">
                      Chat Sessions
                    </span>
                    <MessageSquare className="w-5 h-5 text-pink-400" />
                  </div>
                  <div className="flex items-baseline gap-2">
                    <span className="text-3xl font-bold text-white">{sessions.length}</span>
                    <span className="text-xs text-zinc-500">stored sessions</span>
                  </div>
                </div>
              </div>

              {/* Grid lists of repos */}
              <div className="space-y-4">
                <h2 className="text-lg font-bold text-white flex items-center gap-2">
                  <FileText className="w-4 h-4 text-indigo-400" />
                  <span>Your Source Bases</span>
                </h2>

                {repos.length === 0 ? (
                  <div className="p-12 text-center rounded-2xl border border-dashed border-zinc-800 space-y-4">
                    <div className="inline-flex p-3 bg-zinc-900 rounded-full border border-zinc-800 text-zinc-500">
                      <Github className="w-6 h-6" />
                    </div>
                    <div>
                      <p className="text-sm text-zinc-300 font-semibold">No sources tracked</p>
                      <p className="text-xs text-zinc-500 mt-1 max-w-sm mx-auto">
                        Paste a public repository URL in the sidebar or check out a quick repository addition.
                      </p>
                    </div>
                  </div>
                ) : (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    {repos.map(r => (
                      <div
                        key={r.id}
                        onClick={() => r.status === 'indexed' && handleStartChat(r.id)}
                        className={`p-5 rounded-2xl border transition-all duration-200 group relative ${
                          r.status === 'indexed'
                            ? 'bg-zinc-900/30 border-zinc-800 hover:border-indigo-500/30 hover:bg-zinc-900/50 cursor-pointer'
                            : 'bg-zinc-950/20 border-zinc-900'
                        }`}
                      >
                        <div className="flex items-start justify-between">
                          <div className="space-y-1">
                            <h3 className="font-semibold text-white group-hover:text-indigo-400 transition-colors">
                              {r.name}
                            </h3>
                            <p className="text-[10px] text-zinc-500 font-medium">
                              OWNER: {r.owner} • BRANCH: {r.default_branch}
                            </p>
                          </div>
                          <span
                            className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                              r.status === 'indexed'
                                ? 'bg-emerald-500/10 border border-emerald-500/20 text-emerald-400'
                                : r.status === 'indexing'
                                ? 'bg-amber-500/10 border border-amber-500/20 text-amber-400'
                                : r.status === 'failed'
                                ? 'bg-rose-500/10 border border-rose-500/20 text-rose-400'
                                : 'bg-zinc-850 border border-zinc-800 text-zinc-400'
                            }`}
                          >
                            {r.status}
                          </span>
                        </div>

                        <p className="text-xs text-zinc-400 mt-3 line-clamp-2">
                          Track and query files in this codebase. Supports deep contextual vector lookup.
                        </p>

                        {r.status === 'failed' && r.error_message && (
                          <div className="mt-2.5 p-2.5 rounded-lg bg-red-950/20 border border-red-500/10 text-[11px] text-red-400 font-mono break-all line-clamp-3">
                            {r.error_message}
                          </div>
                        )}

                        <div className="flex items-center justify-between mt-4 pt-3 border-t border-zinc-900">
                          <span className="text-[10px] text-zinc-500 flex items-center gap-1">
                            <Database className="w-3 h-3" />
                            <span>{r.chunk_count} code chunks indexed</span>
                          </span>
                          
                          {r.status === 'indexed' ? (
                            <button className="text-[10px] font-bold text-indigo-400 flex items-center gap-1 group-hover:text-white transition-colors">
                              <span>Start Q&A</span>
                              <ArrowRight className="w-3 h-3" />
                            </button>
                          ) : r.status === 'failed' ? (
                            <span className="text-[10px] text-red-400 flex items-center gap-1" title={r.error_message}>
                              <AlertTriangle className="w-3 h-3" />
                              <span>View Error</span>
                            </span>
                          ) : (
                            <span className="text-[10px] text-zinc-500 flex items-center gap-1.5">
                              <Loader2 className="w-3 h-3 animate-spin" />
                              <span>Indexing files...</span>
                            </span>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Tips Section */}
              <div className="p-6 rounded-2xl bg-indigo-950/20 border border-indigo-500/10 space-y-3">
                <h3 className="text-sm font-bold text-indigo-300 flex items-center gap-2">
                  <Sparkles className="w-4 h-4" />
                  <span>Onboarding & Architecture Guide</span>
                </h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs text-zinc-400 pt-1">
                  <div className="flex gap-2">
                    <CheckCircle2 className="w-4 h-4 shrink-0 text-indigo-400" />
                    <span>Provide public repository URLs. Branch indexing downloads the files directly.</span>
                  </div>
                  <div className="flex gap-2">
                    <CheckCircle2 className="w-4 h-4 shrink-0 text-indigo-400" />
                    <span>The RAG pipeline automatically slices files into line-based segments to track accurate citations.</span>
                  </div>
                  <div className="flex gap-2">
                    <CheckCircle2 className="w-4 h-4 shrink-0 text-indigo-400" />
                    <span>Click on any citation in chat to open the file directly at the exact line reference on GitHub.</span>
                  </div>
                  <div className="flex gap-2">
                    <CheckCircle2 className="w-4 h-4 shrink-0 text-indigo-400" />
                    <span>Configure your OpenAI or Gemini keys inside `backend/.env` for production embeddings.</span>
                  </div>
                </div>
              </div>

            </div>
          </div>
        )}

        {/* B. CHAT WORKSPACE VIEW */}
        {activeTab === 'chat' && selectedSession && (
          <div className="flex-1 flex flex-col h-full overflow-hidden relative">
            
            {/* Chat Header */}
            <div className="px-6 py-4 border-b border-zinc-900 bg-[#050507] flex items-center justify-between">
              <div className="flex items-center gap-3">
                <Github className="w-5 h-5 text-zinc-400" />
                <div>
                  <h2 className="text-sm font-bold text-white flex items-center gap-2">
                    <span>{selectedSession.repository?.name}</span>
                    <span className="px-1.5 py-0.5 rounded bg-zinc-800 text-[9px] text-zinc-400 uppercase font-mono">
                      {selectedSession.repository?.default_branch}
                    </span>
                  </h2>
                  <p className="text-[10px] text-zinc-500 mt-0.5">
                    {selectedSession.repository?.owner}/{selectedSession.repository?.name}
                  </p>
                </div>
              </div>
              <a
                href={selectedSession.repository?.url}
                target="_blank"
                rel="noreferrer"
                className="text-xs text-zinc-400 hover:text-white flex items-center gap-1.5 transition-colors"
              >
                <span>View Repository</span>
                <ExternalLink className="w-3 h-3" />
              </a>
            </div>

            {/* Message Area */}
            <div className="flex-1 overflow-y-auto px-6 py-8 space-y-6">
              {messages.length === 0 ? (
                <div className="max-w-2xl mx-auto text-center py-12 space-y-6">
                  <div className="inline-flex p-4 bg-indigo-600/5 border border-indigo-500/10 rounded-2xl text-indigo-400">
                    <BookOpen className="w-8 h-8" />
                  </div>
                  <div className="space-y-2">
                    <h3 className="text-lg font-bold text-white">Ask anything about {selectedSession.repository?.name}</h3>
                    <p className="text-sm text-zinc-500 max-w-md mx-auto">
                      Explore the project structure, API configurations, algorithms, or ask detailed coding questions.
                    </p>
                  </div>

                  {/* Suggestion prompt boxes */}
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3 pt-4 text-left">
                    <button
                      onClick={() => handleSuggestionClick("What does this project do? Explain its core purpose.")}
                      className="p-4 rounded-xl border border-zinc-800 bg-zinc-950/20 hover:bg-zinc-900/40 hover:border-zinc-700 text-xs text-zinc-300 transition-all text-left flex items-start gap-3 cursor-pointer"
                    >
                      <Info className="w-4 h-4 shrink-0 text-indigo-400 mt-0.5" />
                      <div>
                        <p className="font-semibold text-white">Project Overview</p>
                        <p className="text-zinc-500 mt-0.5">What does this project do?</p>
                      </div>
                    </button>

                    <button
                      onClick={() => handleSuggestionClick("What is the technology stack and architecture of this repository?")}
                      className="p-4 rounded-xl border border-zinc-800 bg-zinc-950/20 hover:bg-zinc-900/40 hover:border-zinc-700 text-xs text-zinc-300 transition-all text-left flex items-start gap-3 cursor-pointer"
                    >
                      <Layers className="w-4 h-4 shrink-0 text-cyan-400 mt-0.5" />
                      <div>
                        <p className="font-semibold text-white">Tech Stack</p>
                        <p className="text-zinc-500 mt-0.5">What is the architecture?</p>
                      </div>
                    </button>

                    <button
                      onClick={() => handleSuggestionClick("Detail the main configuration files and environment parameters.")}
                      className="p-4 rounded-xl border border-zinc-800 bg-zinc-950/20 hover:bg-zinc-900/40 hover:border-zinc-700 text-xs text-zinc-300 transition-all text-left flex items-start gap-3 cursor-pointer"
                    >
                      <Code2 className="w-4 h-4 shrink-0 text-pink-400 mt-0.5" />
                      <div>
                        <p className="font-semibold text-white">Configurations</p>
                        <p className="text-zinc-500 mt-0.5">Detail settings & parameters.</p>
                      </div>
                    </button>

                    <button
                      onClick={() => handleSuggestionClick("Show the main database models, tables or structures defined in the code.")}
                      className="p-4 rounded-xl border border-zinc-800 bg-zinc-950/20 hover:bg-zinc-900/40 hover:border-zinc-700 text-xs text-zinc-300 transition-all text-left flex items-start gap-3 cursor-pointer"
                    >
                      <Database className="w-4 h-4 shrink-0 text-emerald-400 mt-0.5" />
                      <div>
                        <p className="font-semibold text-white">Database Models</p>
                        <p className="text-zinc-500 mt-0.5">Show models, tables & schema.</p>
                      </div>
                    </button>
                  </div>
                </div>
              ) : (
                <div className="max-w-3xl mx-auto space-y-6">
                  {messages.map(m => (
                    <div
                      key={m.id}
                      className={`flex gap-4 p-5 rounded-2xl border ${
                        m.role === 'user'
                          ? 'bg-zinc-950/30 border-zinc-900 ml-12 justify-end'
                          : 'bg-zinc-900/40 border-zinc-800 mr-12'
                      }`}
                    >
                      {/* Avatar for AI */}
                      {m.role === 'assistant' && (
                        <div className="w-8 h-8 rounded-lg bg-indigo-600/10 border border-indigo-500/20 text-indigo-400 flex items-center justify-center shrink-0">
                          <Sparkles className="w-4 h-4" />
                        </div>
                      )}

                      <div className="space-y-4 flex-1 min-w-0">
                        {/* Role label */}
                        <p className="text-[10px] font-bold text-zinc-500 uppercase tracking-wider">
                          {m.role === 'user' ? 'You' : 'Assistant'}
                        </p>

                        <div className="prose-custom">
                          <ReactMarkdown>{m.content}</ReactMarkdown>
                        </div>

                        {/* Message Citations/Sources block */}
                        {m.role === 'assistant' && m.citations && m.citations.length > 0 && (
                          <div className="pt-3 border-t border-zinc-900 space-y-2">
                            <span className="text-[9px] font-bold text-zinc-500 uppercase tracking-wider block">
                              Source Citations
                            </span>
                            <div className="flex flex-wrap gap-2">
                              {m.citations.map((c, idx) => (
                                <a
                                  key={idx}
                                  href={c.url}
                                  target="_blank"
                                  rel="noreferrer"
                                  className="inline-flex items-center gap-1.5 px-2.5 py-1 bg-zinc-900 hover:bg-zinc-850 border border-zinc-850 rounded-lg text-[10px] text-zinc-400 hover:text-white transition-colors cursor-pointer"
                                >
                                  <FileText className="w-3 h-3 text-indigo-400 shrink-0" />
                                  <span className="max-w-[150px] truncate">{c.file_path.split('/').pop()}</span>
                                  <span className="text-zinc-600 font-mono">L{c.start_line}-L{c.end_line}</span>
                                  <ExternalLink className="w-2.5 h-2.5 opacity-60" />
                                </a>
                              ))}
                            </div>
                          </div>
                        )}
                      </div>

                      {/* Avatar for User */}
                      {m.role === 'user' && (
                        <div className="w-8 h-8 rounded-lg bg-indigo-600 border border-indigo-500/30 flex items-center justify-center text-white text-[10px] font-bold shrink-0 overflow-hidden">
                          {user?.avatar_url ? (
                            <img src={user.avatar_url} alt={user.name} className="w-full h-full object-cover" />
                          ) : (
                            user ? getInitials(user.name) : 'U'
                          )}
                        </div>
                      )}
                    </div>
                  ))}

                  {/* Render streaming AI text block if active */}
                  {chatLoading && streamingText && (
                    <div className="flex gap-4 p-5 rounded-2xl border bg-zinc-900/40 border-zinc-800 mr-12">
                      <div className="w-8 h-8 rounded-lg bg-indigo-600/10 border border-indigo-500/20 text-indigo-400 flex items-center justify-center shrink-0">
                        <Sparkles className="w-4 h-4 animate-spin" />
                      </div>
                      <div className="space-y-4 flex-1 min-w-0">
                        <p className="text-[10px] font-bold text-zinc-500 uppercase tracking-wider">
                          Assistant
                        </p>
                        <div className="prose-custom">
                          <ReactMarkdown>{streamingText}</ReactMarkdown>
                        </div>
                      </div>
                    </div>
                  )}

                  {/* If loading but no streaming text yet */}
                  {chatLoading && !streamingText && (
                    <div className="flex gap-4 p-5 rounded-2xl border bg-zinc-900/40 border-zinc-800 mr-12">
                      <div className="w-8 h-8 rounded-lg bg-indigo-600/10 border border-indigo-500/20 text-indigo-400 flex items-center justify-center shrink-0">
                        <Loader2 className="w-4 h-4 animate-spin" />
                      </div>
                      <div className="space-y-2 flex-1 min-w-0">
                        <p className="text-[10px] font-bold text-indigo-400 animate-pulse uppercase tracking-wider">
                          Retrieving codebase contexts...
                        </p>
                      </div>
                    </div>
                  )}

                  <div ref={messagesEndRef} />
                </div>
              )}
            </div>

            {/* Input Form area */}
            <div className="p-4 border-t border-zinc-900 bg-[#050507]">
              <div className="max-w-3xl mx-auto">
                <form onSubmit={handleSendMessage} className="flex gap-2">
                  <input
                    type="text"
                    placeholder={`Ask about ${selectedSession.repository?.name}...`}
                    value={chatInput}
                    onChange={e => setChatInput(e.target.value)}
                    disabled={chatLoading}
                    className="flex-1 px-4 py-3 rounded-xl glass-input text-sm text-white focus:outline-none focus:ring-1 focus:ring-indigo-500 disabled:opacity-55"
                  />
                  <button
                    type="submit"
                    disabled={chatLoading || !chatInput.trim()}
                    className="px-4 bg-indigo-600 hover:bg-indigo-500 disabled:bg-zinc-900 text-white disabled:text-zinc-600 rounded-xl transition-all duration-200 flex items-center justify-center cursor-pointer shadow-lg shadow-indigo-600/10"
                  >
                    <Send className="w-4 h-4" />
                  </button>
                </form>
                <p className="text-[10px] text-zinc-500 mt-2 text-center">
                  Grounded in repository vectors. Answers rely entirely on the indexed code.
                </p>
              </div>
            </div>

          </div>
        )}

      </main>

    </div>
  );
}
