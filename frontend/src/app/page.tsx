'use client';

import React, { useState, useEffect, useRef } from 'react';
import { 
  Github, MessageSquare, Plus, Trash2, LogOut, ExternalLink, 
  Database, AlertTriangle, CheckCircle2, Loader2, Send, 
  Sparkles, BookOpen, ArrowRight, FileText, Code2, Info, Layers
} from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import * as api from '@/lib/api';

export default function Home() {
  const [token, setToken] = useState<string | null>(null);
  const [user, setUser] = useState<api.User | null>(null);
  const [devEmail, setDevEmail] = useState('');
  const [devName, setDevName] = useState('');
  const [authError, setAuthError] = useState('');
  const [authLoading, setAuthLoading] = useState(false);

  const [repos, setRepos] = useState<api.Repository[]>([]);
  const [sessions, setSessions] = useState<api.ChatSession[]>([]);
  const [selectedSession, setSelectedSession] = useState<api.ChatSession | null>(null);
  const [messages, setMessages] = useState<api.Message[]>([]);
  
  const [repoURL, setRepoURL] = useState('');
  const [chatInput, setChatInput] = useState('');
  const [addRepoError, setAddRepoError] = useState('');
  const [addRepoLoading, setAddRepoLoading] = useState(false);
  const [chatLoading, setChatLoading] = useState(false);
  const [streamingText, setStreamingText] = useState('');
  
  const [activeTab, setActiveTab] = useState<'dashboard' | 'chat'>('dashboard');

  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const savedToken = localStorage.getItem('gitmind');
    if (savedToken) {
      setToken(savedToken);
      fetchUserData();
    }
  }, []);

  useEffect(() => {
    if (!token) return;
    const interval = setInterval(() => {
      const indexingRepos = repos.filter(r => r.status === 'indexing' || r.status === 'pending');
      if (indexingRepos.length > 0) loadRepositories();
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
    try { setRepos(await api.listRepos()); } catch (err) { console.error(err); }
  };

  const loadSessions = async () => {
    try { setSessions(await api.listSessions()); } catch (err) { console.error(err); }
  };

  const handleDevLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!devEmail.trim()) { setAuthError('Email is required'); return; }
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
    setToken(null); setUser(null); setRepos([]); setSessions([]);
    setSelectedSession(null); setMessages([]); setActiveTab('dashboard');
  };

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
    if (!confirm('Delete this repository and all its data?')) return;
    try {
      await api.deleteRepo(id);
      if (selectedSession?.repository_id === id) {
        setSelectedSession(null); setMessages([]); setActiveTab('dashboard');
      }
      loadRepositories(); loadSessions();
    } catch (err) { alert('Failed to delete repository'); }
  };

  const handleStartChat = async (repoId: number) => {
    try {
      const session = await api.createSession(repoId);
      loadSessions();
      handleSelectSession(session);
    } catch (err) { alert('Failed starting chat session'); }
  };

  const handleSelectSession = async (session: api.ChatSession) => {
    setSelectedSession(session);
    setActiveTab('chat');
    setStreamingText('');
    try {
      const data = await api.getSession(session.id);
      setMessages(data.messages);
      setTimeout(scrollToBottom, 50);
    } catch (err) { alert('Failed loading session messages'); }
  };

  const handleSendMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!chatInput.trim() || !selectedSession || chatLoading) return;
    const userQuery = chatInput;
    setChatInput(''); setChatLoading(true); setStreamingText('');
    const tempUserMsg: api.Message = {
      id: Date.now(), chat_session_id: selectedSession.id,
      role: 'user', content: userQuery, citations: [],
      created_at: new Date().toISOString(),
    };
    setMessages(prev => [...prev, tempUserMsg]);
    setTimeout(scrollToBottom, 50);
    await api.sendMessageStream(
      selectedSession.id, userQuery,
      (textChunk) => { setStreamingText(prev => prev + textChunk); scrollToBottom(); },
      (meta) => { setStreamingText(''); syncSessionMessages(selectedSession.id); },
      (errorMsg) => { setChatLoading(false); alert('Chat error: ' + errorMsg); }
    );
  };

  const syncSessionMessages = async (sid: string) => {
    try {
      const data = await api.getSession(sid);
      setMessages(data.messages); setChatLoading(false);
      setTimeout(scrollToBottom, 100);
    } catch (e) { setChatLoading(false); }
  };

  const scrollToBottom = () => messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  const handleSuggestionClick = (prompt: string) => setChatInput(prompt);
  const getInitials = (name: string) => name.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2);
  const totalChunks = repos.reduce((acc, r) => acc + r.chunk_count, 0);

  // ─── LOGIN PAGE ───────────────────────────────────────────────────────────
  if (!token) {
    return (
      <div className="flex-1 flex flex-col justify-center items-center px-4 py-16 min-h-screen bg-[#F8FAFC] relative overflow-hidden">
        {/* Subtle Background Elements */}
        <div className="absolute top-[-10%] left-[-10%] w-96 h-96 bg-indigo-500/10 rounded-full blur-3xl" />
        <div className="absolute bottom-[-10%] right-[-10%] w-96 h-96 bg-cyan-500/10 rounded-full blur-3xl" />

        <div className="w-full max-w-sm bg-white/80 backdrop-blur-xl border border-white/50 rounded-[2rem] p-8 space-y-8 shadow-[0_8px_30px_rgb(0,0,0,0.04)] relative z-10">
          <div className="text-center space-y-3">
            <div className="inline-flex p-3.5 rounded-2xl bg-gradient-to-tr from-indigo-500 to-indigo-600 text-white shadow-lg shadow-indigo-500/30 mb-2">
              <Sparkles className="w-6 h-6" />
            </div>
            <h1 className="text-3xl font-extrabold tracking-tight text-slate-900">
              GitMind <span className="text-transparent bg-clip-text bg-gradient-to-r from-indigo-500 to-cyan-500">AI</span>
            </h1>
            <p className="text-sm text-slate-500 font-medium">
              Retrieve, index, and chat with your code.
            </p>
          </div>

          {authError && (
            <div className="p-3.5 bg-red-50 border border-red-100 text-red-600 rounded-xl text-sm flex items-start gap-3 shadow-sm">
              <AlertTriangle className="w-5 h-5 shrink-0" />
              <span>{authError}</span>
            </div>
          )}

          <form onSubmit={handleDevLogin} className="space-y-4">
            <div className="space-y-3">
              <input type="email" placeholder="developer@local.com" value={devEmail}
                onChange={e => setDevEmail(e.target.value)}
                className="w-full px-4 py-3 rounded-xl bg-slate-50 border border-slate-200 text-slate-900 text-sm placeholder:text-slate-400 focus:outline-none focus:bg-white focus:border-indigo-500 focus:ring-4 focus:ring-indigo-500/10 transition-all duration-300"
              />
              <input type="text" placeholder="Developer Name (Optional)" value={devName}
                onChange={e => setDevName(e.target.value)}
                className="w-full px-4 py-3 rounded-xl bg-slate-50 border border-slate-200 text-slate-900 text-sm placeholder:text-slate-400 focus:outline-none focus:bg-white focus:border-indigo-500 focus:ring-4 focus:ring-indigo-500/10 transition-all duration-300"
              />
            </div>
            <button type="submit" disabled={authLoading}
              className="w-full py-3 bg-slate-900 hover:bg-slate-800 text-white font-medium rounded-xl text-sm transition-all duration-300 flex items-center justify-center gap-2 disabled:opacity-50 shadow-md hover:shadow-lg hover:-translate-y-0.5">
              {authLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : (
                <><span>Enter as Guest</span><ArrowRight className="w-4 h-4" /></>
              )}
            </button>
          </form>

          <div className="relative flex items-center justify-center">
            <div className="absolute inset-0 flex items-center">
              <div className="w-full border-t border-slate-200" />
            </div>
            <span className="relative px-4 text-[10px] uppercase tracking-widest font-bold bg-white text-slate-400">
              Or
            </span>
          </div>

          <button onClick={handleGoogleLogin}
            className="w-full py-3 bg-white hover:bg-slate-50 border border-slate-200 text-slate-700 text-sm font-semibold rounded-xl transition-all duration-300 flex items-center justify-center gap-3 shadow-sm hover:shadow-md">
            <svg className="w-4 h-4" viewBox="0 0 24 24">
              <path fill="currentColor" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
              <path fill="currentColor" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
              <path fill="currentColor" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z"/>
              <path fill="currentColor" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z"/>
            </svg>
            <span>Continue with Google</span>
          </button>
        </div>
      </div>
    );
  }

  // ─── AUTHENTICATED LAYOUT ─────────────────────────────────────────────────
  return (
    <div className="flex-1 flex overflow-hidden h-screen bg-[#F8FAFC] text-slate-900 font-sans">

      {/* SIDEBAR */}
      <aside className="w-[280px] flex flex-col h-full shrink-0 bg-white border-r border-slate-200 shadow-[4px_0_24px_rgba(0,0,0,0.02)] z-10 relative">

        {/* Sidebar Header */}
        <div className="h-16 px-5 flex items-center justify-between border-b border-slate-100">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-gradient-to-tr from-indigo-500 to-indigo-600 flex items-center justify-center shadow-md shadow-indigo-500/20">
              <Sparkles className="w-4 h-4 text-white" />
            </div>
            <span className="font-bold tracking-tight text-slate-900">GitMind</span>
          </div>
          <button
            onClick={() => { setSelectedSession(null); setMessages([]); setActiveTab('dashboard'); }}
            className="p-2 rounded-lg text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 transition-all"
            title="Dashboard">
            <Layers className="w-4 h-4" />
          </button>
        </div>

        {/* Add Repository */}
        <div className="p-4 border-b border-slate-100 bg-slate-50/50">
          <form onSubmit={handleAddRepo} className="space-y-2">
            <div className="relative group">
              <input type="text" placeholder="Paste GitHub URL..." value={repoURL}
                onChange={e => setRepoURL(e.target.value)}
                className="w-full pl-4 pr-10 py-2.5 rounded-xl bg-white border border-slate-200 shadow-sm text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none focus:border-indigo-500 focus:ring-4 focus:ring-indigo-500/10 transition-all duration-300" />
              <button type="submit" disabled={addRepoLoading || !repoURL}
                className="absolute right-1.5 top-1.5 bottom-1.5 w-8 flex items-center justify-center rounded-lg bg-indigo-50 text-indigo-600 hover:bg-indigo-600 hover:text-white disabled:bg-slate-100 disabled:text-slate-400 transition-all duration-300">
                {addRepoLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
              </button>
            </div>
            {addRepoError && (
              <p className="text-[11px] text-red-500 px-1 font-medium">{addRepoError}</p>
            )}
          </form>
        </div>

        {/* Sidebar Nav */}
        <div className="flex-1 overflow-y-auto px-3 py-5 space-y-8">

          {/* Repositories */}
          <div className="space-y-1.5">
            <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider px-3 block mb-3">
              Sources
            </span>
            {repos.length === 0 ? (
              <p className="text-xs px-3 text-slate-500 italic">No repositories yet</p>
            ) : repos.map(r => (
              <div key={r.id}
                onClick={() => r.status === 'indexed' && handleStartChat(r.id)}
                className={`group w-full flex items-center justify-between px-3 py-2.5 rounded-xl text-left transition-all duration-200 cursor-pointer ${
                  selectedSession?.repository_id === r.id && activeTab === 'chat'
                    ? 'bg-indigo-50 text-indigo-700 font-medium' 
                    : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900 font-medium'
                }`}>
                <div className="flex items-center gap-3 min-w-0 flex-1">
                  <Github className={`w-4 h-4 shrink-0 ${selectedSession?.repository_id === r.id && activeTab === 'chat' ? 'text-indigo-600' : 'text-slate-400 group-hover:text-slate-600'}`} />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm truncate leading-tight">{r.name}</p>
                  </div>
                </div>
                <div className="flex items-center gap-2 shrink-0 ml-2">
                  {r.status === 'indexing' && <Loader2 className="w-3.5 h-3.5 animate-spin text-indigo-500" />}
                  {r.status === 'pending' && <span className="h-2 w-2 rounded-full bg-slate-300" />}
                  {r.status === 'indexed' && <span className="h-2 w-2 rounded-full bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.4)]" />}
                  {r.status === 'failed' && <span className="h-2 w-2 rounded-full bg-red-500" title={r.error_message} />}
                  
                  <button onClick={(e) => handleDeleteRepo(r.id, e)}
                    className="p-1.5 rounded-md opacity-0 group-hover:opacity-100 text-slate-400 hover:text-red-600 hover:bg-red-50 transition-all"
                    title="Remove Repository">
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            ))}
          </div>

          {/* Sessions */}
          <div className="space-y-1.5">
            <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider px-3 block mb-3">
              Chats
            </span>
            {sessions.length === 0 ? (
              <p className="text-xs px-3 text-slate-500 italic">No conversations</p>
            ) : sessions.map(s => (
              <button key={s.id} onClick={() => handleSelectSession(s)}
                className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-left transition-all duration-200 ${
                  selectedSession?.id === s.id 
                    ? 'bg-indigo-50 text-indigo-700 font-medium' 
                    : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900 font-medium'
                }`}>
                <MessageSquare className={`w-4 h-4 shrink-0 ${selectedSession?.id === s.id ? 'text-indigo-600' : 'text-slate-400'}`} />
                <span className="text-sm truncate flex-1">{s.title}</span>
              </button>
            ))}
          </div>

        </div>

        {/* User footer */}
        {user && (
          <div className="p-4 border-t border-slate-100 bg-white flex items-center justify-between">
            <div className="flex items-center gap-3 min-w-0">
              <div className="w-9 h-9 rounded-full bg-slate-100 border border-slate-200 flex items-center justify-center text-slate-700 font-bold text-xs shrink-0 overflow-hidden shadow-sm">
                {user.avatar_url
                  ? <img src={user.avatar_url} alt={user.name} className="w-full h-full object-cover" />
                  : getInitials(user.name)}
              </div>
              <div className="min-w-0">
                <p className="text-sm font-bold text-slate-900 truncate">{user.name}</p>
                <p className="text-[11px] font-medium text-slate-500 truncate">{user.email}</p>
              </div>
            </div>
            <button onClick={handleLogout}
              className="p-2 rounded-lg text-slate-400 hover:text-red-600 hover:bg-red-50 transition-all" title="Logout">
              <LogOut className="w-4 h-4" />
            </button>
          </div>
        )}
      </aside>

      {/* MAIN VIEWPORT */}
      <main className="flex-1 flex flex-col h-full overflow-hidden relative">

        {/* DASHBOARD */}
        {activeTab === 'dashboard' && (
          <div className="flex-1 overflow-y-auto px-10 py-12">
            <div className="max-w-5xl mx-auto space-y-10">

              {/* Header */}
              <div className="flex items-end justify-between pb-6 border-b border-slate-200">
                <div className="space-y-1">
                  <h1 className="text-3xl font-extrabold text-slate-900 tracking-tight">Overview</h1>
                  <p className="text-base text-slate-500 font-medium">
                    Manage your synced codebases and context limits.
                  </p>
                </div>
                <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-emerald-50 border border-emerald-100 text-emerald-700 text-xs font-bold shadow-sm">
                  <span className="relative flex h-2 w-2">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                    <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
                  </span>
                  System Online
                </div>
              </div>

              {/* Stats */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
                {[
                  { label: 'Synced Repos', value: repos.length, icon: <Github className="w-5 h-5 text-indigo-600" />, bg: 'bg-indigo-50' },
                  { label: 'Vector Contexts', value: totalChunks, icon: <Database className="w-5 h-5 text-cyan-600" />, bg: 'bg-cyan-50' },
                  { label: 'Total Sessions', value: sessions.length, icon: <MessageSquare className="w-5 h-5 text-violet-600" />, bg: 'bg-violet-50' },
                ].map((stat, i) => (
                  <div key={i} className="p-6 rounded-2xl bg-white border border-slate-200 shadow-sm hover:shadow-md transition-shadow flex items-center justify-between group">
                    <div className="space-y-1">
                      <span className="text-xs font-bold text-slate-500 uppercase tracking-wider">{stat.label}</span>
                      <div className="text-3xl font-extrabold text-slate-900">{stat.value}</div>
                    </div>
                    <div className={`p-4 rounded-xl ${stat.bg} group-hover:scale-110 transition-transform duration-300`}>
                      {stat.icon}
                    </div>
                  </div>
                ))}
              </div>

              {/* Repos grid */}
              <div className="space-y-5">
                <h2 className="text-lg font-bold text-slate-900 flex items-center gap-2">
                  <FileText className="w-5 h-5 text-slate-400" />
                  <span>Tracked Sources</span>
                </h2>

                {repos.length === 0 ? (
                  <div className="p-16 flex flex-col items-center justify-center text-center rounded-3xl border-2 border-dashed border-slate-200 bg-slate-50/50">
                    <div className="p-4 rounded-2xl bg-white shadow-sm border border-slate-200 text-slate-400 mb-4">
                      <Github className="w-8 h-8" />
                    </div>
                    <h3 className="text-lg font-bold text-slate-900">No repositories added</h3>
                    <p className="text-sm text-slate-500 mt-1 max-w-sm">Paste a GitHub link in the sidebar to start indexing your first project.</p>
                  </div>
                ) : (
                  <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
                    {repos.map(r => (
                      <div key={r.id}
                        onClick={() => r.status === 'indexed' && handleStartChat(r.id)}
                        className={`p-6 rounded-2xl border transition-all duration-300 group relative overflow-hidden ${
                          r.status === 'indexed' 
                            ? 'bg-white hover:border-indigo-300 hover:shadow-[0_8px_30px_rgb(79,70,229,0.08)] cursor-pointer border-slate-200' 
                            : 'bg-slate-50/80 border-slate-200 cursor-default'
                        }`}>
                        
                        <div className="flex items-start justify-between">
                          <div className="space-y-1.5">
                            <h3 className="font-bold text-lg text-slate-900 group-hover:text-indigo-600 transition-colors line-clamp-1">{r.name}</h3>
                            <p className="text-xs font-medium text-slate-500 flex items-center gap-1.5">
                              <span>{r.owner}</span>
                              <span className="w-1 h-1 rounded-full bg-slate-300" />
                              <span className="bg-slate-100 px-1.5 py-0.5 rounded text-[10px] uppercase font-bold text-slate-600 border border-slate-200">{r.default_branch}</span>
                            </p>
                          </div>
                          <span className={`px-2.5 py-1 rounded-lg text-[10px] font-bold uppercase tracking-wider border shadow-sm ${
                              r.status === 'indexed' ? 'bg-emerald-50 border-emerald-200 text-emerald-700'
                              : r.status === 'indexing' ? 'bg-amber-50 border-amber-200 text-amber-700'
                              : r.status === 'failed' ? 'bg-red-50 border-red-200 text-red-700'
                              : 'bg-slate-100 border-slate-200 text-slate-600'
                            }`}>
                            {r.status}
                          </span>
                        </div>

                        {r.status === 'failed' && r.error_message && (
                          <div className="mt-4 p-3 rounded-xl bg-red-50 border border-red-100 text-xs text-red-600 font-mono break-all line-clamp-2">
                            {r.error_message}
                          </div>
                        )}

                        <div className="flex items-center justify-between mt-6 pt-5 border-t border-slate-100">
                          <span className="text-xs font-medium text-slate-500 flex items-center gap-1.5 bg-slate-50 px-2 py-1 rounded-md border border-slate-100">
                            <Database className="w-3.5 h-3.5" />
                            <span>{r.chunk_count} code chunks</span>
                          </span>
                          {r.status === 'indexed' ? (
                            <button className="text-sm font-bold text-indigo-600 group-hover:text-indigo-700 flex items-center gap-1.5 transition-colors">
                              <span>Chat</span><ArrowRight className="w-4 h-4" />
                            </button>
                          ) : r.status === 'failed' ? (
                            <span className="text-xs font-bold text-red-600 flex items-center gap-1.5">
                              <AlertTriangle className="w-4 h-4" /><span>Indexing Failed</span>
                            </span>
                          ) : (
                            <span className="text-xs font-bold text-amber-600 flex items-center gap-1.5">
                              <Loader2 className="w-4 h-4 animate-spin" /><span>Processing...</span>
                            </span>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {/* CHAT VIEW */}
        {activeTab === 'chat' && selectedSession && (
          <div className="flex-1 flex flex-col h-full overflow-hidden relative bg-white">
            
            {/* Top glass gradient */}
            <div className="absolute top-0 left-0 right-0 h-24 bg-gradient-to-b from-white via-white/80 to-transparent pointer-events-none z-10" />

            {/* Chat Header */}
            <div className="h-16 px-8 border-b border-slate-100 bg-white/80 backdrop-blur-md flex items-center justify-between z-20 sticky top-0">
              <div className="flex items-center gap-3">
                <div className="p-1.5 rounded-lg bg-slate-100 text-slate-600 border border-slate-200">
                  <Github className="w-4 h-4" />
                </div>
                <div className="flex items-center gap-2">
                  <h2 className="text-sm font-bold text-slate-900">{selectedSession.repository?.name}</h2>
                  <span className="px-2 py-0.5 rounded-md text-[10px] font-bold uppercase tracking-wider bg-slate-100 text-slate-500 border border-slate-200">
                    {selectedSession.repository?.default_branch}
                  </span>
                </div>
              </div>
              <a href={selectedSession.repository?.url} target="_blank" rel="noreferrer"
                className="text-xs font-bold flex items-center gap-1.5 text-slate-500 hover:text-indigo-600 transition-colors px-3 py-1.5 rounded-lg hover:bg-indigo-50">
                <span>View Source</span><ExternalLink className="w-3.5 h-3.5" />
              </a>
            </div>

            {/* Messages */}
            <div className="flex-1 overflow-y-auto px-4 sm:px-8 lg:px-12 py-8 space-y-8 scroll-smooth">
              {messages.length === 0 ? (
                <div className="max-w-2xl mx-auto flex flex-col items-center justify-center text-center py-20 space-y-8">
                  <div className="p-4 rounded-2xl bg-indigo-50 text-indigo-600 border border-indigo-100 shadow-sm shadow-indigo-500/10 mb-2">
                    <BookOpen className="w-8 h-8" />
                  </div>
                  <div className="space-y-2">
                    <h3 className="text-2xl font-extrabold text-slate-900">How can I help you understand this project?</h3>
                    <p className="text-base text-slate-500 max-w-md mx-auto">
                      Ask me anything about the architecture, codebase, or specific logic within <span className="font-bold text-slate-700">{selectedSession.repository?.name}</span>.
                    </p>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 w-full pt-6">
                    {[
                      { icon: <Info className="w-4 h-4 text-indigo-500" />, title: 'Project Overview', prompt: 'What does this project do? Explain its core purpose.' },
                      { icon: <Layers className="w-4 h-4 text-cyan-500" />, title: 'Architecture', prompt: 'What is the technology stack and architecture of this repository?' },
                      { icon: <Code2 className="w-4 h-4 text-amber-500" />, title: 'Configurations', prompt: 'Detail the main configuration files and environment parameters.' },
                      { icon: <Database className="w-4 h-4 text-emerald-500" />, title: 'Database Schema', prompt: 'Show the main database models, tables or structures defined in the code.' },
                    ].map(s => (
                      <button key={s.title} onClick={() => handleSuggestionClick(s.prompt)}
                        className="p-4 rounded-2xl border border-slate-200 bg-white shadow-sm hover:shadow-md hover:border-indigo-300 transition-all text-left flex items-start gap-3 group">
                        <div className="p-2 rounded-lg bg-slate-50 group-hover:bg-white border border-slate-100">{s.icon}</div>
                        <div>
                          <p className="text-sm font-bold text-slate-900 group-hover:text-indigo-600 transition-colors">{s.title}</p>
                          <p className="text-xs text-slate-500 mt-1 leading-snug">{s.prompt}</p>
                        </div>
                      </button>
                    ))}
                  </div>
                </div>
              ) : (
                <div className="max-w-4xl mx-auto space-y-8 pb-10">
                  {messages.map(m => (
                    <div key={m.id} className={`flex gap-4 ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                      {m.role === 'assistant' && (
                        <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-indigo-500 to-indigo-600 shadow-md flex items-center justify-center shrink-0 border border-indigo-400">
                          <Sparkles className="w-5 h-5 text-white" />
                        </div>
                      )}
                      
                      <div className={`max-w-[85%] space-y-4 ${
                        m.role === 'user' 
                          ? 'bg-slate-900 text-white px-6 py-5 rounded-3xl rounded-tr-sm shadow-md' 
                          : 'bg-white border border-slate-200 text-slate-800 px-6 py-5 rounded-3xl rounded-tl-sm shadow-sm'
                      }`}>
                        <div className={`prose prose-sm md:prose-base max-w-none ${m.role === 'user' ? 'prose-invert prose-p:leading-relaxed' : 'prose-slate prose-p:leading-relaxed prose-headings:font-bold prose-a:text-indigo-600 prose-pre:bg-slate-50 prose-pre:border prose-pre:border-slate-200 prose-pre:text-slate-800'}`}>
                          <ReactMarkdown>{m.content}</ReactMarkdown>
                        </div>

                        {m.role === 'assistant' && m.citations && m.citations.length > 0 && (
                          <div className="pt-4 mt-4 border-t border-slate-100 space-y-3">
                            <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider flex items-center gap-1.5">
                              <BookOpen className="w-3 h-3" /> Grounded Sources
                            </span>
                            <div className="flex flex-wrap gap-2">
                              {m.citations.map((c, idx) => (
                                <a key={idx} href={c.url} target="_blank" rel="noreferrer"
                                  className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-slate-50 border border-slate-200 text-[11px] font-medium text-slate-600 hover:text-indigo-700 hover:bg-indigo-50 hover:border-indigo-200 transition-colors shadow-sm">
                                  <FileText className="w-3 h-3 text-slate-400" />
                                  <span className="truncate max-w-[150px]">{c.file_path.split('/').pop()}</span>
                                  <span className="text-slate-400 px-1 border-l border-slate-200">Line {c.start_line}</span>
                                </a>
                              ))}
                            </div>
                          </div>
                        )}
                      </div>

                      {m.role === 'user' && (
                        <div className="w-10 h-10 rounded-xl bg-slate-100 border border-slate-200 shadow-sm flex items-center justify-center text-slate-700 text-sm font-bold shrink-0 overflow-hidden">
                          {user?.avatar_url
                            ? <img src={user.avatar_url} alt={user.name} className="w-full h-full object-cover" />
                            : user ? getInitials(user.name) : 'U'}
                        </div>
                      )}
                    </div>
                  ))}

                  {chatLoading && streamingText && (
                    <div className="flex gap-4 justify-start animate-in fade-in slide-in-from-bottom-2 duration-300">
                      <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-indigo-500 to-indigo-600 shadow-md flex items-center justify-center shrink-0 border border-indigo-400">
                        <Sparkles className="w-5 h-5 text-white" />
                      </div>
                      <div className="max-w-[85%] bg-white border border-slate-200 text-slate-800 px-6 py-5 rounded-3xl rounded-tl-sm shadow-sm">
                        <div className="prose prose-sm md:prose-base prose-slate max-w-none">
                          <ReactMarkdown>{streamingText}</ReactMarkdown>
                        </div>
                      </div>
                    </div>
                  )}

                  {chatLoading && !streamingText && (
                    <div className="flex gap-4 justify-start">
                      <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-indigo-500 to-indigo-600 shadow-md flex items-center justify-center shrink-0 border border-indigo-400">
                        <Loader2 className="w-5 h-5 text-white animate-spin" />
                      </div>
                      <div className="flex items-center px-6 py-4 rounded-3xl rounded-tl-sm bg-white border border-slate-200 shadow-sm text-sm font-medium text-slate-500 animate-pulse">
                        Analyzing repository vectors...
                      </div>
                    </div>
                  )}
                  <div ref={messagesEndRef} />
                </div>
              )}
            </div>

            {/* Input Area */}
            <div className="p-4 sm:p-6 bg-white/80 backdrop-blur-xl border-t border-slate-200 z-20">
              <div className="max-w-4xl mx-auto relative">
                <form onSubmit={handleSendMessage} className="relative flex items-center shadow-sm rounded-2xl group">
                  <input type="text"
                    placeholder="Ask a question about the code..."
                    value={chatInput} onChange={e => setChatInput(e.target.value)}
                    disabled={chatLoading}
                    className="w-full pl-6 pr-16 py-4 rounded-2xl bg-white border-2 border-slate-200 text-base text-slate-900 placeholder:text-slate-400 focus:outline-none focus:border-indigo-500 focus:ring-4 focus:ring-indigo-500/10 transition-all disabled:opacity-50 disabled:bg-slate-50" />
                  <button type="submit" disabled={chatLoading || !chatInput.trim()}
                    className="absolute right-2 p-2.5 rounded-xl bg-indigo-600 text-white hover:bg-indigo-700 hover:shadow-md disabled:bg-slate-100 disabled:text-slate-400 disabled:shadow-none transition-all duration-300 transform active:scale-95">
                    <Send className="w-5 h-5" />
                  </button>
                </form>
                <div className="text-[11px] font-medium text-slate-400 text-center mt-3">
                  AI responses are generated based on indexed codebase context. Verify critical information.
                </div>
              </div>
            </div>

          </div>
        )}
      </main>
    </div>
  );
}