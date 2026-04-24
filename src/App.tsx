/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useCallback } from 'react';
import { 
  auth, 
  db, 
  googleProvider, 
  signInWithPopup, 
  signOut, 
  onAuthStateChanged, 
  collection, 
  query, 
  where, 
  onSnapshot, 
  addDoc, 
  serverTimestamp,
  deleteDoc,
  doc as firestoreDoc,
  User,
  OperationType,
  handleFirestoreError
} from './firebase';
import { analyzeCREDocument, generateMarketReport, DealAnalysis } from './services/geminiService';
import { useDropzone } from 'react-dropzone';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Building2, TrendingUp, AlertTriangle, Lightbulb, Plus, FileText, LogOut, LogIn, Search, MapPin, DollarSign, Percent } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import ReactMarkdown from 'react-markdown';

interface Deal extends DealAnalysis {
  id: string;
  status: string;
  createdAt: any;
  userId: string;
}

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [deals, setDeals] = useState<Deal[]>([]);
  const [marketReport, setMarketReport] = useState<string>('');
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [analysisProgress, setAnalysisProgress] = useState(0);
  const [analysisError, setAnalysisError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState('dashboard');
  const [searchQuery, setSearchQuery] = useState('');
  const [uploadedFiles, setUploadedFiles] = useState<File[]>([]);
  const [analysisType, setAnalysisType] = useState<'Listing' | 'Offering Memorandum' | 'Market Report'>('Listing');

  const onDrop = useCallback((acceptedFiles: File[]) => {
    setUploadedFiles(prev => [...prev, ...acceptedFiles]);
  }, []);

  const { getRootProps, getInputProps, isDragActive } = useDropzone({ 
    onDrop,
    accept: {
      'application/pdf': ['.pdf'],
      'image/*': ['.png', '.jpg', '.jpeg'],
      'text/plain': ['.txt']
    }
  });

  const removeFile = (index: number) => {
    setUploadedFiles(prev => prev.filter((_, i) => i !== index));
  };

  const fileToBase64 = (file: File): Promise<string> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.readAsDataURL(file);
      reader.onload = () => {
        const base64String = reader.result as string;
        resolve(base64String.split(',')[1]);
      };
      reader.onerror = error => reject(error);
    });
  };

  // Auth Listener
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (user) => {
      setUser(user);
      setLoading(false);
    });
    return () => unsubscribe();
  }, []);

  // Firestore Listener
  useEffect(() => {
    if (!user) {
      setDeals([]);
      return;
    }

    const q = query(collection(db, 'deals'), where('userId', '==', user.uid));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const dealsData = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Deal));
      setDeals(dealsData.sort((a, b) => (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0)));
    }, (error) => {
      handleFirestoreError(error, OperationType.LIST, 'deals');
    });

    return () => unsubscribe();
  }, [user]);

  // Generate Market Report
  useEffect(() => {
    if (deals.length > 0 && !marketReport) {
      generateMarketReport(deals).then(setMarketReport);
    }
  }, [deals, marketReport]);

  const handleLogin = async () => {
    try {
      await signInWithPopup(auth, googleProvider);
    } catch (error) {
      console.error('Login failed', error);
    }
  };

  const handleLogout = () => signOut(auth);

  const handleAnalyze = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!user) return;

    const formData = new FormData(e.currentTarget);
    const text = formData.get('documentText') as string;
    
    if (!text && uploadedFiles.length === 0) return;

    setIsAnalyzing(true);
    setAnalysisError(null);
    setAnalysisProgress(10);
    try {
      const fileData = await Promise.all(uploadedFiles.map(async (file, idx) => {
        const data = await fileToBase64(file);
        setAnalysisProgress(prev => Math.min(prev + (20 / uploadedFiles.length), 30));
        return { mimeType: file.type, data };
      }));

      setAnalysisProgress(40);
      const analyses = await analyzeCREDocument(text || "See attached documents.", fileData, deals, analysisType);
      
      setAnalysisProgress(80);
      for (const analysis of analyses) {
        // Check for exact duplicates (same name and address)
        const existingDuplicate = deals.find(d => 
          d.name === analysis.name && 
          (d.address === analysis.address || (!d.address && !analysis.address))
        );

        if (existingDuplicate) {
          console.log(`Found duplicate for ${analysis.name}, removing old record...`);
          await deleteDoc(firestoreDoc(db, 'deals', existingDuplicate.id));
        }

        await addDoc(collection(db, 'db_deals' in (deals[0] || {}) ? 'deals' : 'deals'), {
          ...analysis,
          status: 'Active',
          userId: user.uid,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
      }
      
      setAnalysisProgress(100);
      setTimeout(() => {
        setUploadedFiles([]);
        if (analysisType === 'Listing') setActiveTab('deals');
        else if (analysisType === 'Offering Memorandum') setActiveTab('oms');
        else setActiveTab('market');
        setAnalysisProgress(0);
      }, 500);
    } catch (error: any) {
      console.error("Analysis Error:", error);
      let message = "An error occurred during analysis.";
      if (error?.message?.includes("RESOURCE_EXHAUSTED") || error?.message?.includes("429")) {
        message = "The AI is currently at capacity due to high demand in the IE region. Please wait a minute and try again.";
      } else if (error?.status === "PERMISSION_DENIED") {
        handleFirestoreError(error, OperationType.CREATE, 'deals');
        return;
      }
      setAnalysisError(message);
    } finally {
      setIsAnalyzing(false);
      setAnalysisProgress(0);
    }
  };

  const renderDealCard = (deal: Deal) => (
    <div className="bento-card h-full group hover:bg-zinc-50 transition-colors flex flex-col">
      <div className="flex items-start justify-between mb-4">
        <div className="flex items-center gap-2">
          <div className="market-badge">{deal.assetType}</div>
          <div className={`text-[9px] font-bold px-2 py-0.5 rounded-full ${
            deal.confidenceScore > 80 ? 'bg-teal-50 text-teal-700' : 
            deal.confidenceScore > 50 ? 'bg-amber-50 text-amber-700' : 'bg-red-50 text-red-700'
          }`}>
            {deal.confidenceScore}% Valid
          </div>
        </div>
        <div className={`text-[10px] font-black uppercase px-2 py-0.5 border ${
          deal.status === 'Active' ? 'border-gem-score text-gem-score' : 'border-zinc-300 text-zinc-400'
        }`}>
          {deal.status}
        </div>
      </div>
      
      <div className="text-lg font-black tracking-tighter mb-1 line-clamp-1">{deal.name}</div>
      <div className="text-[12px] text-text-muted flex items-center gap-1 mb-4">
        <MapPin size={12} /> {deal.address || 'Inland Empire'}
      </div>

      <div className="bg-zinc-100/50 p-3 rounded-lg mb-6 border border-zinc-200/50">
        <div className="text-[10px] font-bold uppercase tracking-widest text-text-muted mb-1">Agent Summary</div>
        <p className="text-[11px] leading-relaxed text-zinc-600 font-medium italic">
          "{deal.summary || 'Analyze document for summary...'}"
        </p>
      </div>

      <div className="grid grid-cols-2 gap-4 mb-6">
        <div className="space-y-0.5">
          <div className="text-[9px] font-bold uppercase text-text-muted tracking-widest">Price</div>
          <div className="text-lg font-black">${(deal.price / 1000000).toFixed(2)}M</div>
        </div>
        <div className="space-y-0.5">
          <div className="text-[9px] font-bold uppercase text-text-muted tracking-widest">Est. CoC</div>
          <div className="text-lg font-black text-primary">{deal.cashOnCashReturn ? `${deal.cashOnCashReturn}%` : '---'}</div>
        </div>
      </div>

      <div className="space-y-2 mb-6">
        <div className="flex items-center justify-between text-[10px] font-bold uppercase tracking-widest">
          <span className="text-text-muted">Gem Score</span>
          <span className="text-gem-score">{deal.hiddenGemScore}/100</span>
        </div>
        <div className="h-1.5 w-full bg-zinc-100 overflow-hidden">
          <div 
            className="h-full bg-border-main transition-all duration-500" 
            style={{ width: `${deal.hiddenGemScore}%` }}
          />
        </div>
      </div>

      <div className="mt-auto">
        <Dialog>
          <DialogTrigger render={
            <Button variant="outline" className="w-full border border-border rounded-lg font-bold uppercase text-[10px] tracking-widest py-5 hover:bg-zinc-50 shadow-sm transition-all">
              Full Terminal View
            </Button>
          } />
          <DialogContent className="max-w-[1200px] w-[92vw] h-[92vh] border-none rounded-3xl p-0 overflow-hidden shadow-2xl flex flex-col bg-zinc-50">
            {/* TERMINAL HEADER: STICKY AUDIT INFO */}
            <div className="p-8 bg-zinc-900 text-white border-b border-white/10 flex items-center justify-between z-10 shrink-0">
              <div className="space-y-1">
                <div className="flex items-center gap-3">
                  <div className="bg-gem-score/20 text-gem-score px-2 py-0.5 rounded text-[10px] font-black uppercase tracking-[0.2em] animate-pulse">Live Analysis</div>
                  <div className="text-zinc-500 text-[10px] font-bold uppercase tracking-widest">Terminal ID: {deal.id.slice(0,16)}</div>
                </div>
                <h2 className="text-4xl font-black tracking-tighter leading-none">{deal.name}</h2>
                <div className="text-zinc-400 text-xs font-medium flex items-center gap-2 pt-1 uppercase tracking-widest">
                  <MapPin size={12} className="text-gem-score" /> {deal.address || 'Inland Empire Submarket'}
                </div>
              </div>
              
              <div className="flex items-center gap-10">
                <div className="text-right">
                  <div className="text-[10px] font-black uppercase tracking-[0.2em] text-zinc-500 mb-1 leading-none">Gem Score</div>
                  <div className="text-5xl font-black text-gem-score leading-none tracking-tighter">{deal.hiddenGemScore}</div>
                </div>
                <div className="h-12 w-px bg-white/10" />
                <div className="text-right">
                  <div className="text-[10px] font-black uppercase tracking-[0.2em] text-zinc-500 mb-1 leading-none">Confidence</div>
                  <div className={`text-5xl font-black leading-none tracking-tighter ${deal.confidenceScore > 80 ? 'text-teal-400' : 'text-amber-400'}`}>
                    {deal.confidenceScore}%
                  </div>
                </div>
              </div>
            </div>

            {/* LONG RECTANGLE SCROLL FLOW */}
            <div className="flex-1 overflow-y-auto">
              <div className="p-10 space-y-16 max-w-5xl mx-auto pb-32">
                
                {/* 01: CORE FINANCIAL STACK */}
                <section className="space-y-8">
                  <div className="flex items-center gap-4">
                    <div className="h-px flex-1 bg-zinc-200" />
                    <div className="text-[11px] font-black uppercase tracking-[0.3em] text-zinc-400">01 // Financial Extraction</div>
                    <div className="h-px flex-1 bg-zinc-200" />
                  </div>
                  
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                    {[
                      { label: 'Asset Class', value: deal.assetType, color: 'text-zinc-900' },
                      { label: 'Current Price', value: `$${(deal.price / 1000000).toFixed(2)}M`, color: 'text-zinc-900' },
                      { label: 'Est. CoC Return', value: `${deal.cashOnCashReturn || '---'}%`, color: 'text-gem-score' },
                      { label: 'Cap Rate', value: `${deal.capRate || '---'}%`, color: 'text-primary' }
                    ].map((metric, i) => (
                      <div key={i} className="bg-white p-6 border-2 border-zinc-100 rounded-2xl">
                        <div className="text-[9px] font-black uppercase tracking-widest text-zinc-400 mb-2">{metric.label}</div>
                        <div className={`text-2xl font-black tracking-tight ${metric.color}`}>{metric.value}</div>
                      </div>
                    ))}
                  </div>

                  <div className="bg-white p-8 border-2 border-zinc-100 rounded-[2rem] shadow-sm">
                    <div className="text-[10px] font-black uppercase tracking-widest text-primary mb-4 flex items-center gap-2">
                       <div className="h-1.5 w-1.5 rounded-full bg-primary" /> Agent Intelligence Summary
                    </div>
                    <p className="text-lg font-medium text-zinc-600 leading-relaxed italic">
                      "{deal.summary}"
                    </p>
                  </div>
                </section>

                {/* 02: RISK & ASYMMETRIC UPSIDE */}
                <section className="space-y-8">
                  <div className="flex items-center gap-4">
                    <div className="h-px flex-1 bg-zinc-200" />
                    <div className="text-[11px] font-black uppercase tracking-[0.3em] text-zinc-400">02 // Vulnerability Audit</div>
                    <div className="h-px flex-1 bg-zinc-200" />
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    <div className="bg-white p-8 border-2 border-zinc-100 rounded-[2rem] space-y-6">
                      <div className="text-[10px] font-black uppercase tracking-widest text-destructive flex items-center gap-2">
                        <AlertTriangle size={14} /> Hard Red Flags
                      </div>
                      <div className="space-y-3">
                        {deal.redFlags.map((flag, i) => (
                          <div key={i} className="flex gap-3 text-sm font-bold text-red-700 bg-red-50 p-4 rounded-xl border border-red-100">
                            <span className="opacity-30">0{i+1}</span>
                            <span>{flag}</span>
                          </div>
                        ))}
                      </div>
                    </div>

                    <div className="bg-white p-8 border-2 border-zinc-100 rounded-[2rem] space-y-6">
                      <div className="text-[10px] font-black uppercase tracking-widest text-gem-score flex items-center gap-2">
                        <Lightbulb size={14} /> Value-Add Catalysts
                      </div>
                      <div className="space-y-3">
                        {deal.valueAddOpportunities.map((opp, i) => (
                          <div key={i} className="flex gap-3 text-sm font-bold text-teal-700 bg-teal-50 p-4 rounded-xl border border-teal-100">
                            <span className="opacity-30">0{i+1}</span>
                            <span>{opp}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                </section>

                {/* 03: UNDERWRITING NARRATIVE */}
                <section className="space-y-8">
                  <div className="flex items-center gap-4">
                    <div className="h-px flex-1 bg-zinc-200" />
                    <div className="text-[11px] font-black uppercase tracking-[0.3em] text-zinc-400">03 // Alpha Underwriting</div>
                    <div className="h-px flex-1 bg-zinc-200" />
                  </div>

                  <div className="bg-white border-2 border-zinc-100 p-12 rounded-[3.5rem] prose prose-zinc max-w-none prose-p:leading-loose prose-headings:font-black prose-p:text-zinc-600 prose-headings:tracking-tighter shadow-sm">
                    {deal.analysis ? (
                      <ReactMarkdown>{deal.analysis}</ReactMarkdown>
                    ) : (
                      <div className="flex flex-col items-center justify-center py-20 text-zinc-200 uppercase font-black tracking-widest text-sm italic">
                        De-crypting Analysis Data...
                      </div>
                    )}
                  </div>
                </section>

                {/* 04: NEGOTIATION PLAYBOOK */}
                <section className="space-y-8 bg-zinc-900 -mx-10 p-12 rounded-[4rem]">
                  <div className="flex items-center gap-4">
                    <div className="h-px flex-1 bg-white/10" />
                    <div className="text-[11px] font-black uppercase tracking-[0.3em] text-zinc-500">04 // Strategic Scenarios</div>
                    <div className="h-px flex-1 bg-white/10" />
                  </div>

                  <div className="grid grid-cols-1 gap-6">
                    {deal.negotiationStrategy?.map((strategy, i) => (
                      <div key={i} className="bg-zinc-800/50 border border-white/5 p-8 rounded-[2rem] group hover:bg-zinc-800 transition-colors">
                        <div className="flex items-center justify-between mb-6">
                           <div className={`px-2 py-0.5 rounded text-[10px] font-black uppercase tracking-widest ${
                             strategy.target === 'Seller' ? 'bg-red-500/10 text-red-400' : 'bg-teal-500/10 text-teal-400'
                           }`}>
                             {strategy.target} Protocol
                           </div>
                           <div className="text-zinc-700 font-mono text-[10px]">OB_DECON_0{i+1}</div>
                        </div>
                        <h4 className="text-xl font-black text-white mb-4 leading-tight italic">"{strategy.doubt}"</h4>
                        <div className="bg-zinc-900 p-6 rounded-2xl border border-white/5">
                           <div className="text-[9px] font-black text-gem-score uppercase tracking-[0.2em] mb-2">Combat Script</div>
                           <p className="text-zinc-400 text-sm leading-relaxed font-medium">
                             {strategy.combat}
                           </p>
                        </div>
                      </div>
                    ))}
                  </div>

                  <div className="pt-12 space-y-10">
                    <div className="text-center">
                      <div className="text-[10px] font-black text-zinc-600 uppercase tracking-[0.5em] mb-2">Technical Hard Questions</div>
                      <h3 className="text-3xl font-black text-white tracking-widest uppercase">The Hot Seat</h3>
                    </div>
                    
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-10">
                      {deal.ownerCriticalQuestions?.map((q, i) => (
                        <div key={i} className="space-y-4">
                          <div className="text-5xl font-black text-zinc-800/50 italic leading-none">0{i+1}</div>
                          <p className="text-sm font-black text-white leading-snug">"{q.question}"</p>
                          <p className="text-xs text-zinc-500 leading-relaxed">
                            <span className="text-gem-score font-black uppercase mr-1">RESPONSE:</span> {q.answer}
                          </p>
                        </div>
                      ))}
                    </div>
                  </div>
                </section>

                {/* 05: MARKET INTELLIGENCE */}
                <section className="space-y-8">
                  <div className="flex items-center gap-4">
                    <div className="h-px flex-1 bg-zinc-200" />
                    <div className="text-[11px] font-black uppercase tracking-[0.3em] text-zinc-400">05 // Market Delta Data</div>
                    <div className="h-px flex-1 bg-zinc-200" />
                  </div>

                  <div className="grid gap-6 sm:grid-cols-2">
                    {deal.historicalComparison?.map((item, i) => (
                      <div key={i} className="bg-white p-8 rounded-[2rem] border-2 border-zinc-100">
                        <div className="flex justify-between items-center mb-4 pb-4 border-b border-zinc-50">
                           <span className="text-[10px] font-black text-primary uppercase tracking-widest">{item.period} Marker</span>
                           <TrendingUp size={16} className="text-zinc-300" />
                        </div>
                        <p className="text-[13px] leading-relaxed text-zinc-600 font-medium italic">
                          {item.analysis}
                        </p>
                      </div>
                    ))}
                  </div>
                </section>

              </div>
            </div>
          </DialogContent>
        </Dialog>
      </div>
    </div>
  );

  if (loading) {
    return (
      <div className="flex h-screen items-center justify-center bg-zinc-50">
        <motion.div 
          animate={{ rotate: 360 }}
          transition={{ duration: 1, repeat: Infinity, ease: "linear" }}
          className="h-8 w-8 border-4 border-zinc-900 border-t-transparent rounded-full"
        />
      </div>
    );
  }

  if (!user) {
    return (
      <div className="flex h-screen flex-col items-center justify-center bg-zinc-50 p-4 text-center">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="max-w-md space-y-6"
        >
          <div className="flex justify-center">
            <div className="rounded-2xl bg-zinc-900 p-4 text-white shadow-xl">
              <Building2 size={48} />
            </div>
          </div>
          <h1 className="text-4xl font-bold tracking-tight text-zinc-900">IE CRE Agent</h1>
          <p className="text-lg text-zinc-600">
            Your direct line to Inland Empire commercial real estate analysis. 
            Track trends, score deals, and find value-add opportunities.
          </p>
          <Button onClick={handleLogin} size="lg" className="w-full bg-zinc-900 hover:bg-zinc-800">
            <LogIn className="mr-2 h-5 w-5" /> Sign in with Google
          </Button>
        </motion.div>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen bg-bg text-text-main font-sans">
      {/* Sidebar */}
      <aside className="w-[260px] bg-white border-r border-border p-6 flex flex-col gap-5 shrink-0 hidden lg:flex shadow-[4px_0_24px_rgba(0,0,0,0.02)]">
        <div className="font-bold text-xl tracking-tight pb-5 border-b border-zinc-100 flex items-center gap-2.5">
          <div className="h-8 w-8 bg-primary rounded-lg flex items-center justify-center text-white">
            <Building2 size={18} />
          </div>
          Agent Terminal
        </div>
        
        <div>
          <div className="card-label flex items-center justify-between">
            {activeTab === 'deals' ? 'Listings' : activeTab === 'oms' ? 'Offering Memorandums' : 'Market Data'}
            <span className="text-[9px] text-text-muted font-normal normal-case">
              {deals.filter(d => {
                if (activeTab === 'deals') return d.docType === 'Listing' || !d.docType;
                if (activeTab === 'oms') return d.docType === 'Offering Memorandum';
                if (activeTab === 'market') return d.docType === 'Market Report';
                return true;
              }).length} Records
            </span>
          </div>
          <div className="h-[400px] overflow-y-auto pr-2">
            <ul className="space-y-1">
              {deals
                .filter(d => {
                  if (activeTab === 'deals') return d.docType === 'Listing' || !d.docType;
                  if (activeTab === 'oms') return d.docType === 'Offering Memorandum';
                  if (activeTab === 'market') return d.docType === 'Market Report';
                  return true;
                })
                .map((deal) => (
                  <li 
                    key={deal.id}
                    onClick={() => {
                      setSearchQuery(deal.name);
                      if (deal.docType === 'Offering Memorandum') setActiveTab('oms');
                      else if (deal.docType === 'Market Report') setActiveTab('market');
                      else setActiveTab('deals');
                    }}
                    className={`text-[12px] px-3 py-2.5 rounded-lg border cursor-pointer transition-all ${
                      searchQuery === deal.name 
                        ? 'border-border bg-zinc-50 font-bold text-primary shadow-sm' 
                        : 'border-transparent hover:bg-zinc-50/80 text-text-muted hover:text-text-main'
                    }`}
                  >
                    {deal.name.length > 25 ? deal.name.slice(0, 25) + '...' : deal.name}
                  </li>
                ))}
              {deals.length === 0 && (
                <li className="text-[13px] text-text-muted italic px-3 py-2">No data yet</li>
              )}
            </ul>
          </div>
        </div>

        <div className="mt-auto space-y-4">
          <div className="text-[12px] opacity-60 leading-tight">
            Connected: Inland Empire MLS<br />
            Last Sync: Just now
          </div>
          <Separator className="bg-zinc-100" />
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div className="h-8 w-8 rounded-full bg-zinc-900 flex items-center justify-center text-white text-xs font-bold">
                {user.displayName?.charAt(0)}
              </div>
              <div className="text-[11px] font-bold truncate max-w-[100px]">
                {user.displayName}
              </div>
            </div>
            <Button variant="ghost" size="icon" onClick={handleLogout} className="h-8 w-8 text-text-muted hover:text-text-main">
              <LogOut size={16} />
            </Button>
          </div>
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 p-8 lg:p-12 overflow-y-auto bg-zinc-50">
        <div className="max-w-[1800px] mx-auto">
          <header className="flex flex-col sm:flex-row justify-between items-start sm:items-end gap-6 mb-10">
          <div>
            <h1 className="text-[28px] font-extrabold tracking-tighter leading-none">
              Inland Empire CRE Terminal
            </h1>
            <p className="text-text-muted text-sm mt-1">Real-time analysis and market intelligence.</p>
          </div>
            <div className="flex items-center gap-3">
              <Badge variant="outline" className="border-border text-zinc-500 font-bold uppercase tracking-wider h-6 rounded-full px-3">IE Submarket: Active</Badge>
              <Dialog>
                <DialogTrigger render={
                  <Button className="bg-primary hover:bg-zinc-800 text-white rounded-lg h-9 px-4 text-xs font-bold uppercase tracking-wider shadow-sm transition-all active:scale-95">
                    <Plus className="mr-2 h-3.5 w-3.5" /> New Analysis
                  </Button>
                } />
              <DialogContent className="sm:max-w-[700px] border border-border rounded-xl shadow-2xl p-0 overflow-hidden">
                <DialogHeader className="p-8 pb-0">
                  <DialogTitle className="text-2xl font-black tracking-tight uppercase">Analyze IE Logistics & CRE</DialogTitle>
                  <DialogDescription className="text-sm text-text-muted mt-2">
                    Upload documents to cross-reference against your database of {deals.length} records.
                  </DialogDescription>
                </DialogHeader>

                <div className="px-8 mt-6">
                  <div className="flex bg-zinc-100 p-1 rounded-lg w-full">
                    {(['Listing', 'Offering Memorandum', 'Market Report'] as const).map((type) => (
                      <button
                        key={type}
                        onClick={() => setAnalysisType(type)}
                        className={`flex-1 py-2 text-[10px] font-bold uppercase tracking-widest rounded-md transition-all ${
                          analysisType === type 
                            ? 'bg-white text-primary shadow-sm' 
                            : 'text-text-muted hover:text-text-main'
                        }`}
                      >
                        {type === 'Listing' ? 'Listing/Flyer' : type === 'Offering Memorandum' ? 'Full OM' : 'Market Report'}
                      </button>
                    ))}
                  </div>
                </div>

                <form onSubmit={handleAnalyze} className="p-8 pt-4 space-y-6">
                  <div className="space-y-2">
                    <Label className="text-[10px] font-bold uppercase tracking-widest flex items-center justify-between">
                      {analysisType} Documents
                      <span className="text-[9px] font-normal lowercase text-text-muted">PDF or Images</span>
                    </Label>
                    <div 
                      {...getRootProps()} 
                      className={`border-2 border-dashed border-border-main p-6 text-center cursor-pointer transition-colors ${isDragActive ? 'bg-zinc-50' : 'hover:bg-zinc-50'}`}
                    >
                      <input {...getInputProps()} />
                      <Plus className="mx-auto h-6 w-6 text-text-muted mb-2" />
                      <p className="text-xs text-text-muted">Drag & drop files here, or click to select</p>
                    </div>
                    
                    {uploadedFiles.length > 0 && (
                      <div className="mt-2 space-y-1">
                        {uploadedFiles.map((file, i) => (
                          <div key={i} className="flex items-center justify-between bg-zinc-50 px-3 py-1 text-[11px] border border-border-main">
                            <span className="truncate max-w-[200px]">{file.name}</span>
                            <Button 
                              type="button" 
                              variant="ghost" 
                              size="icon" 
                              className="h-4 w-4 text-red-flag"
                              onClick={() => removeFile(i)}
                            >
                              <Plus className="rotate-45 h-3 w-3" />
                            </Button>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="documentText" className="text-[10px] font-bold uppercase tracking-widest">Or Paste Text</Label>
                    <Textarea 
                      id="documentText" 
                      name="documentText" 
                      placeholder="Paste document content here..." 
                      className="min-h-[150px] font-mono text-sm border-2 border-border rounded-lg focus-visible:ring-1"
                    />
                  </div>

                  {isAnalyzing && (
                    <div className="space-y-2">
                      <div className="flex justify-between text-[10px] font-bold uppercase tracking-widest text-primary">
                        <span>AI Document Processing</span>
                        <span>{Math.round(analysisProgress)}%</span>
                      </div>
                      <div className="h-2 w-full bg-zinc-100 rounded-full overflow-hidden border border-zinc-200">
                        <motion.div 
                          className="h-full bg-primary"
                          initial={{ width: 0 }}
                          animate={{ width: `${analysisProgress}%` }}
                          transition={{ duration: 0.3 }}
                        />
                      </div>
                    </div>
                  )}

                  <Button 
                    type="submit" 
                    className={`w-full h-14 rounded-lg font-black uppercase tracking-[0.2em] text-xs transition-all shadow-lg active:scale-[0.98] ${
                      isAnalyzing 
                        ? 'bg-zinc-100 text-zinc-400 cursor-not-allowed shadow-none' 
                        : 'bg-zinc-900 hover:bg-zinc-800 text-white hover:shadow-xl hover:-translate-y-0.5'
                    }`}
                    disabled={isAnalyzing}
                  >
                    {isAnalyzing ? "Processing..." : "Run Analysis"}
                  </Button>

                  {analysisError && (
                    <div className="p-4 bg-red-50 border border-red-200 rounded-xl flex items-start gap-3">
                      <AlertTriangle className="text-red-600 shrink-0 mt-0.5" size={16} />
                      <div className="space-y-1">
                        <p className="text-[11px] font-black uppercase text-red-700 tracking-wider">System Alert</p>
                        <p className="text-xs text-red-600 font-medium leading-relaxed">{analysisError}</p>
                      </div>
                    </div>
                  )}
                </form>
              </DialogContent>
            </Dialog>
          </div>
        </header>

        <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-6">
          <TabsList className="bg-zinc-100 p-1 rounded-lg inline-flex mb-8">
            <TabsTrigger value="dashboard" className="rounded-md data-[state=active]:bg-white data-[state=active]:shadow-sm text-xs font-semibold px-6">Dashboard</TabsTrigger>
            <TabsTrigger value="deals" className="rounded-md data-[state=active]:bg-white data-[state=active]:shadow-sm text-xs font-semibold px-6">Listings & Deals</TabsTrigger>
            <TabsTrigger value="oms" className="rounded-md data-[state=active]:bg-white data-[state=active]:shadow-sm text-xs font-semibold px-6">Offering Memorandums</TabsTrigger>
            <TabsTrigger value="market" className="rounded-md data-[state=active]:bg-white data-[state=active]:shadow-sm text-xs font-semibold px-6">Market Report</TabsTrigger>
          </TabsList>

          {/* Dashboard Bento Grid */}
          <TabsContent value="dashboard" className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mt-0">
            {/* Metric 1 */}
            <div className="bento-card">
              <div className="card-label">Hidden Gem Score</div>
              <div className="metric-value text-gem-score">
                {deals.length > 0 
                  ? Math.round(deals.reduce((acc, d) => acc + d.hiddenGemScore, 0) / deals.length)
                  : 0}
                <span className="text-lg text-text-muted">/100</span>
              </div>
              <p className="text-[11px] mt-2 text-text-muted font-medium">Average across your active workspace.</p>
            </div>

            {/* Metric 2 */}
            <div className="bento-card">
              <div className="card-label">Deal Heat Rating</div>
              <div className="metric-value">
                {deals.length > 0 
                  ? Math.round(deals.reduce((acc, d) => acc + d.dealHeatRating, 0) / deals.length)
                  : 0}
                <span className="text-lg text-text-muted">%</span>
              </div>
              <div className="h-2 bg-zinc-100 mt-3 relative">
                <div 
                  className="h-full bg-gradient-to-r from-amber-400 to-orange-500 transition-all duration-1000" 
                  style={{ width: `${deals.length > 0 ? Math.round(deals.reduce((acc, d) => acc + d.dealHeatRating, 0) / deals.length) : 0}%` }}
                />
              </div>
            </div>

            {/* Main Analysis Card (Span 2x2) */}
            <div className="bento-card lg:col-span-2 lg:row-span-2">
              <div className="card-label">Latest Deal Analysis</div>
              {deals.length > 0 ? (
                <div className="flex flex-col h-full">
                  <div className="text-[22px] font-bold mt-2 leading-tight">{deals[0].name}</div>
                  <div className="text-[13px] text-text-muted mb-4">{deals[0].assetType} | {deals[0].address || 'Inland Empire'}</div>
                  
                  <div className="space-y-1">
                    <div className="data-row">
                      <span>Asking Price</span>
                      <strong className="font-black">${(deals[0].price / 1000000).toFixed(2)}M</strong>
                    </div>
                    <div className="data-row">
                      <span>Cap Rate</span>
                      <strong className="font-black">{deals[0].capRate || 'N/A'}%</strong>
                    </div>
                    <div className="data-row">
                      <span>NOI</span>
                      <strong className="font-black">${(deals[0].noi || 0).toLocaleString()}</strong>
                    </div>
                  </div>

                  <div className="card-label mt-6">Value-Add Opportunity</div>
                  <div className="text-[13px] leading-relaxed line-clamp-4 italic text-zinc-700">
                    {deals[0].valueAddOpportunities[0] || 'No specific value-add identified yet.'}
                  </div>
                  
                  <Button 
                    variant="outline" 
                    className="mt-auto border border-border rounded-lg font-bold uppercase text-[10px] tracking-widest py-5 hover:bg-zinc-50"
                    onClick={() => setActiveTab('deals')}
                  >
                    View Full Portfolio
                  </Button>
                </div>
              ) : (
                <div className="flex flex-col items-center justify-center h-full text-text-muted italic py-12">
                  No deals analyzed yet.
                </div>
              )}
            </div>

            {/* Red Flags (Span 1x2) */}
            <div className="bento-card lg:row-span-2">
              <div className="card-label">Red Flags & Risks</div>
              <div className="flex-1 overflow-y-auto">
                <ul className="space-y-3 mt-2">
                  {deals.length > 0 ? deals[0].redFlags.map((flag, i) => (
                    <li key={i} className="text-destructive text-[13px] font-semibold flex items-start gap-2 leading-tight">
                      <span className="text-[10px] mt-0.5">⚠️</span>
                      {flag}
                    </li>
                  )) : (
                    <li className="text-text-muted text-[13px] italic">No data available</li>
                  )}
                </ul>
              </div>
              <div className="mt-4 pt-4 border-t border-zinc-100 text-[11px] opacity-70">
                *Based on latest document scan.
              </div>
            </div>

            {/* Market Delta */}
            <div className="bento-card">
              <div className="card-label">Market Delta: '21 vs Current</div>
              <div className="space-y-2 mt-1">
                <div className="data-row border-none py-1">
                  <span className="text-[11px]">IE Avg Cap</span>
                  <strong className="text-[13px]">5.2%</strong>
                </div>
                <div className="data-row border-none py-1">
                  <span className="text-[11px]">Rent Growth</span>
                  <strong className="text-[13px] text-gem-score">+12% ↑</strong>
                </div>
              </div>
            </div>

            {/* Offer Strategy (Span 2x1) */}
            <div className="bento-card lg:col-span-2">
              <div className="card-label">Suggested Offer Strategy</div>
              <div className="strategy-box">
                {deals.length > 0 
                  ? deals[0].analysis.split('\n')[0].slice(0, 150) + '...'
                  : "Analyze a deal to see suggested negotiation strategies."}
              </div>
            </div>

            {/* Market Context */}
            <div className="bento-card">
              <div className="card-label">IE Absorption</div>
              <div className="text-[24px] font-black">-1.2M SF</div>
              <p className="text-[11px] mt-1 text-text-muted">Slowing but small-bay holding.</p>
            </div>
          </TabsContent>

          {/* Listings & Deals */}
          <TabsContent value="deals" className="space-y-6">
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
              <div>
                <h2 className="text-2xl font-bold tracking-tight text-zinc-900 leading-tight">Active Listings & Deals</h2>
                <p className="text-sm text-text-muted">Short summaries and first impressions of upcoming market opportunities.</p>
              </div>
              <div className="relative w-full md:w-72">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-400" size={16} />
                <Input 
                  className="pl-10 h-10 rounded-lg border-border" 
                  placeholder="Filter listings..." 
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                />
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              <AnimatePresence mode="popLayout">
                {deals
                  .filter(d => (d.docType === 'Listing' || !d.docType) && (d.name.toLowerCase().includes(searchQuery.toLowerCase()) || d.address?.toLowerCase().includes(searchQuery.toLowerCase()) || d.assetType.toLowerCase().includes(searchQuery.toLowerCase())))
                  .map((deal) => (
                    <motion.div
                      key={deal.id}
                      layout
                      initial={{ opacity: 0, scale: 0.95 }}
                      animate={{ opacity: 1, scale: 1 }}
                      exit={{ opacity: 0, scale: 0.95 }}
                    >
                      {renderDealCard(deal)}
                    </motion.div>
                  ))
                }
              </AnimatePresence>
            </div>
          </TabsContent>

          {/* Offering Memorandums */}
          <TabsContent value="oms" className="space-y-6">
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
              <div>
                <h2 className="text-2xl font-bold tracking-tight text-zinc-900 leading-tight">Offering Memorandums</h2>
                <p className="text-sm text-text-muted">In-depth underwriting documents and detailed property dossiers.</p>
              </div>
              <div className="relative w-full md:w-72">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-400" size={16} />
                <Input 
                  className="pl-10 h-10 rounded-lg border-border" 
                  placeholder="Filter OMs..." 
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                />
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              <AnimatePresence mode="popLayout">
                {deals
                  .filter(d => d.docType === 'Offering Memorandum' && (d.name.toLowerCase().includes(searchQuery.toLowerCase()) || d.address?.toLowerCase().includes(searchQuery.toLowerCase()) || d.assetType.toLowerCase().includes(searchQuery.toLowerCase())))
                  .map((deal) => (
                    <motion.div
                      key={deal.id}
                      layout
                      initial={{ opacity: 0, scale: 0.95 }}
                      animate={{ opacity: 1, scale: 1 }}
                      exit={{ opacity: 0, scale: 0.95 }}
                    >
                      {renderDealCard(deal)}
                    </motion.div>
                  ))
                }
              </AnimatePresence>
            </div>
          </TabsContent>

          {/* Market Report */}
          <TabsContent value="market" className="space-y-12">
            {/* Uploaded Market Reports */}
            {deals.some(d => d.docType === 'Market Report') && (
              <section className="space-y-6">
                <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                  <div>
                    <h2 className="text-2xl font-bold tracking-tight text-zinc-900 leading-tight">Uploaded Market Data</h2>
                    <p className="text-sm text-text-muted">Macro trends and submarket analytics processed via the terminal.</p>
                  </div>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                  {deals
                    .filter(d => d.docType === 'Market Report')
                    .map((deal) => (
                      <motion.div key={deal.id} layout>
                        {renderDealCard(deal)}
                      </motion.div>
                    ))
                  }
                </div>
              </section>
            )}

            {/* Generated Intelligence Report */}
            <section className="space-y-6">
              <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                <div>
                  <h2 className="text-2xl font-bold tracking-tight text-zinc-900 leading-tight">Cross-Portfolio Intelligence</h2>
                  <p className="text-sm text-text-muted">Automated macro-analysis of all active listings and OMs compared to 2021 peaks.</p>
                </div>
                <Button 
                  onClick={() => generateMarketReport(deals).then(setMarketReport)}
                  variant="outline"
                  className="rounded-lg h-9 px-4 text-xs font-bold uppercase tracking-widest border-border hover:bg-zinc-50"
                >
                  Refresh Intelligence
                </Button>
              </div>
              
              <div className="prose prose-zinc max-w-none prose-p:leading-relaxed prose-headings:font-bold prose-p:text-zinc-600 bg-white border border-border p-8 rounded-2xl shadow-[0_4px_24px_rgba(0,0,0,0.03)]">
                {marketReport ? (
                  <ReactMarkdown>{marketReport}</ReactMarkdown>
                ) : (
                  <div className="flex flex-col items-center justify-center py-12 text-text-muted gap-4">
                    <TrendingUp size={48} className="opacity-20" />
                    <p className="italic">Generating aggregate portfolio intelligence...</p>
                  </div>
                )}
              </div>
            </section>
          </TabsContent>
        </Tabs>
        </div>
      </main>
    </div>
  );
}
