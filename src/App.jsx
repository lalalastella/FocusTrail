import React, { useState, useEffect, useRef } from 'react';
import {
  Calendar as CalendarIcon, BarChart2, Activity, ChevronRight, ChevronLeft, Home,
  CheckCircle, Edit3, Zap, ShieldAlert,
  Settings as SettingsIcon, X
} from 'lucide-react';

import { THEMES } from './data/themes';
import { INITIAL_STATS } from './data/initialData';
import { getLevelForMinutes, getRewardBounds, clamp01, formatMins } from './data/rewards';
import { loadTasks, loadNotes, loadHistory, loadSettings } from './utils/storage';
import { stripExtension, fileToBase64 } from './utils/file';
import { findNodeById, findPathToNode, updateNodeById } from './utils/taskTree';
import {
  RECOVERY_HISTORY_KEY,
  appendRecoveryHistory,
  applyRecoveryProposal,
  buildRecoveryContext,
  createRecoveryRecord,
  loadRecoveryHistory,
  validateRecoveryProposal,
} from './utils/replan';
import { postBreakdownRequest } from './services/breakdownApi';
import { postReplanRequest } from './services/replanApi';
import { fetchStats, recordFocusSession, recordCompletedTask } from './services/statsApi';
import './styles/runtimeAnimations';
import { API_BASE, HAS_REMOTE_API, WEB_DEMO_MODE } from './config/runtime';

import ViewA from './components/views/ViewA.jsx';
import ViewB from './components/views/ViewB';
import ViewCE from './components/views/ViewCE';
import NavItem from './components/common/NavItem';
import ProgressRing from './components/common/ProgressRing';
import RewardProgressModal from './components/common/RewardProgressModal';
import RecoveryPlanModal from './components/common/RecoveryPlanModal';
import LeftPanels from './components/panels/LeftPanels';
import QuickNotesPanel from './components/panels/QuickNotesPanel';

export default function FocusTrailApp() {
  // Global States
  // Default to Day theme (user request)
  const [theme, setTheme] = useState('light');
  const t = THEMES[theme];
  const [showSplash, setShowSplash] = useState(true);
  const [splashKey, setSplashKey] = useState(0);

  useEffect(() => {
    if (!showSplash) return undefined;
    const timer = window.setTimeout(() => setShowSplash(false), 3200);
    return () => window.clearTimeout(timer);
  }, [showSplash, splashKey]);

  const replaySplash = () => {
    setSplashKey((current) => current + 1);
    setShowSplash(true);
  };
  
  const [tasks, setTasks] = useState(loadTasks);
  const [activeTaskId, setActiveTaskId] = useState(null); // Which root task is active
  const [path, setPath] = useState([]); // Subtask drill-down path: [taskId, subtaskId, ...]
  
  const [stats, setStats] = useState({ ...INITIAL_STATS, focusTimeToday: 0, sessions: 0, avgSession: 0, completionRate: 0, distractCount: 0, distractTime: 0, taskCompletionMinutes: 0, weightedCredit: 0, focusScore: 0 });
  const [historyRecords, setHistoryRecords] = useState(loadHistory);
  const [hiddenHistoryIds, setHiddenHistoryIds] = useState(() => {
    try {
      const saved = localStorage.getItem('fc_hidden_history_ids');
      return saved ? JSON.parse(saved) : [];
    } catch {
      return [];
    }
  });
  const [notes, setNotes] = useState(loadNotes);
  const [isNotesOpen, setIsNotesOpen] = useState(false); // mobile / tablet drawer
  const [isNotesSidebarOpen, setIsNotesSidebarOpen] = useState(true); // desktop sidebar
  const [notesSidebarWidth, setNotesSidebarWidth] = useState(320); // default 320px, resizable
  const [navWidth, setNavWidth] = useState(180); // left nav width, resizable
  const [navCollapsed, setNavCollapsed] = useState(false); // 左侧导航折叠

  // Tasks: 每次变化自动保存到 localStorage
  useEffect(() => {
    localStorage.setItem('fc_tasks', JSON.stringify(tasks));
  }, [tasks]);

  // Quick Notes: 每次 notes 变化自动保存到 localStorage
  useEffect(() => {
    localStorage.setItem('fc_notes', JSON.stringify(notes));
  }, [notes]);
  const [settings, setSettings] = useState(loadSettings);

  // UI States
  const [activePanel, setActivePanel] = useState(null); // 'calendar'|'stats'|'monitor'|'settings'
  const [isFocusedMode, setIsFocusedMode] = useState(false); // Collapses sidebars
  const [toast, setToast] = useState(null);
  const [isRewardsOpen, setIsRewardsOpen] = useState(false);
  const [composerText, setComposerText] = useState('');
  const [composerFile, setComposerFile] = useState(null);
  const [isAiWorking, setIsAiWorking] = useState(false);
  const [submissionPreview, setSubmissionPreview] = useState(null);
  const initialRequestControllerRef = useRef(null);
  const [isRecoveryOpen, setIsRecoveryOpen] = useState(false);
  const [recoveryActiveTaskId, setRecoveryActiveTaskId] = useState(null);
  const [recoveryHistory, setRecoveryHistory] = useState(loadRecoveryHistory);

  // Sync settings theme to state
  useEffect(() => { setTheme(settings.theme); }, [settings.theme]);

  // Load real stats from the local backend. If the server is off, the UI still works with local fallback values.
  useEffect(() => {
    fetchStats()
      .then((serverStats) => setStats((prev) => ({ ...prev, ...serverStats })))
      .catch(() => {
        // Keep the app usable when only the Vite frontend is running.
      });
  }, []);

  // Real-time stats updates from the monitor agent via SSE
  useEffect(() => {
    if (!HAS_REMOTE_API) return undefined;
    const sse = new EventSource(`${API_BASE}/api/monitor/stream`);
    sse.addEventListener('stats.updated', (e) => {
      try {
        const updated = JSON.parse(e.data);
        setStats((prev) => ({ ...prev, ...updated }));
      } catch {}
    });
    sse.onerror = () => {};
    return () => sse.close();
  }, []);

  // Settings + task breakdown history are persisted locally.
  useEffect(() => {
    localStorage.setItem('fc_settings', JSON.stringify(settings));
  }, [settings]);

  useEffect(() => {
    localStorage.setItem('fc_task_history', JSON.stringify(historyRecords));
  }, [historyRecords]);

  useEffect(() => {
    localStorage.setItem('fc_hidden_history_ids', JSON.stringify(hiddenHistoryIds));
  }, [hiddenHistoryIds]);

  useEffect(() => {
    localStorage.setItem(RECOVERY_HISTORY_KEY, JSON.stringify(recoveryHistory));
  }, [recoveryHistory]);

  useEffect(() => {
    const records = tasks
      .filter(task => task.children?.length || task.sourceContext?.contextId)
      .map(task => ({
        id: task.id,
        title: task.title,
        date: task.date || '',
        hasDueDate: Boolean(task.date),
        breakdownCount: task.children?.length || 0,
        updatedAt: new Date().toISOString(),
      }));

    setHistoryRecords(prev => {
      const merged = new Map(prev.map(record => [record.id, record]));
      records
        .filter(record => !hiddenHistoryIds.includes(record.id))
        .forEach(record => merged.set(record.id, { ...(merged.get(record.id) || {}), ...record }));
      hiddenHistoryIds.forEach(id => merged.delete(id));
      return Array.from(merged.values());
    });
  }, [tasks, hiddenHistoryIds]);

  // Rewards + level are measured in "focus minutes" (demo).
  const rewardBounds = getRewardBounds(stats.focusScore);
  const rewardProgress = clamp01((stats.focusScore - rewardBounds.prev) / (rewardBounds.next - rewardBounds.prev));
  const nearReward = rewardProgress >= 0.9;
  const userLevel = getLevelForMinutes(stats.focusScore);


  // Determine App State
  // State A: !activeTaskId
  // State B: activeTaskId && path.length === 0
  // State C/E: activeTaskId && path.length > 0
  // State D is handled inline when a specific subtask is actively being focused (local state inside ViewCE)
  
  const activeRootTask = tasks.find(tsk => tsk.id === activeTaskId);
  
  // Helpers
  const showToast = (msg, type = 'success') => {
    setToast({ msg, type, id: Date.now() });
    if (type !== 'loading') {
      setTimeout(() => setToast(null), type === 'warning' ? 5000 : 3000);
    }
    // 'loading' toasts persist until the next showToast call clears them
  };
  const openRewards = () => setIsRewardsOpen(true);
  const closeRewards = () => setIsRewardsOpen(false);

  const convertAiStepsToChildren = (steps, parentId, source = 'gemma') => {
    return (steps || []).slice(0, 3).map((step, index) => ({
      id: `${parentId}-ai-${index + 1}`,
      title: step.title,
      progress: 0,
      status: step.status || 'pending',
      desc: `${step.desc || ''}${step.estimatedMinutes ? ` (${step.estimatedMinutes} min)` : ''}`,
      estimatedMinutes: step.estimatedMinutes || 10,
      priority: step.priority || index + 1,
      aiSource: source,
      children: [],
    }));
  };

  const convertAiStepToNode = (step, nodeId, source = 'gemma', slotIndex = 0) => ({
    id: nodeId,
    title: step.title,
    progress: 0,
    status: step.status || 'pending',
    desc: `${step.desc || ''}${step.estimatedMinutes ? ` (${step.estimatedMinutes} min)` : ''}`,
    estimatedMinutes: step.estimatedMinutes || 10,
    priority: step.priority || slotIndex + 1,
    aiSource: source,
    children: [],
  });

  const createNewTask = (title, date, extra = {}) => {
    const d = date || new Date().toISOString().split('T')[0];
    const newTask = {
      id: `task_${Date.now()}`,
      title,
      progress: 0,
      status: 'pending',
      date: d,
      desc: 'No description provided.',
      children: [],
      ...extra,
    };
    setTasks((prev) => [...prev, newTask]);
    showToast('Task added successfully');
    return newTask;
  };

  const getTaskEstimatedMinutes = (task) => {
    if (!task) return 0;
    const own = Number(task.estimatedMinutes) || 0;
    const childTotal = (task.children || []).reduce((sum, child) => sum + getTaskEstimatedMinutes(child), 0);
    return Math.max(own, childTotal, 10);
  };

  const mergeStatsFallback = (patch = {}) => {
    setStats(prev => {
      const next = { ...prev, ...patch };
      const weightedCredit = Math.round((next.focusTimeToday || 0) * 0.6 + (next.taskCompletionMinutes || 0) * 0.4);
      return { ...next, weightedCredit, focusScore: weightedCredit };
    });
  };

  const markTaskDoneLocally = (taskToComplete) => {
    if (!taskToComplete?.id) return;

    setTasks(prev => prev.map(root => {
      if (root.id === taskToComplete.id) {
        return { ...root, status: 'done', progress: 100, completedAt: new Date().toISOString() };
      }

      const existsInChildren = findNodeById(root.children || [], taskToComplete.id);
      if (!existsInChildren) return root;

      return {
        ...root,
        children: updateNodeById(root.children || [], taskToComplete.id, node => ({
          ...node,
          status: 'done',
          progress: 100,
          completedAt: new Date().toISOString(),
        })),
      };
    }));
  };

  const handleFocusSessionComplete = async ({ task, minutes, startedAt, endedAt }) => {
    if (!task?.id || !minutes) return;

    if (WEB_DEMO_MODE) {
      mergeStatsFallback({
        focusTimeToday: (stats.focusTimeToday || 0) + minutes,
        sessions: (stats.sessions || 0) + 1,
      });
      return;
    }

    try {
      const updatedStats = await recordFocusSession({
        taskId: task.id,
        taskTitle: task.title,
        minutes,
        startedAt,
        endedAt,
      });
      setStats(prev => ({ ...prev, ...updatedStats }));
    } catch (error) {
      mergeStatsFallback({
        focusTimeToday: (stats.focusTimeToday || 0) + minutes,
        sessions: (stats.sessions || 0) + 1,
      });
      showToast('Backend stats save failed, using local fallback.', 'warning');
    }
  };

  const handleTaskComplete = async (taskToComplete) => {
    if (!taskToComplete?.id) return;

    markTaskDoneLocally(taskToComplete);
    const minutes = getTaskEstimatedMinutes(taskToComplete);

    if (WEB_DEMO_MODE) {
      mergeStatsFallback({
        taskCompletionMinutes: (stats.taskCompletionMinutes || 0) + minutes,
      });
      return;
    }

    try {
      const updatedStats = await recordCompletedTask({
        taskId: taskToComplete.id,
        taskTitle: taskToComplete.title,
        estimatedMinutes: minutes,
        completedAt: new Date().toISOString(),
      });
      setStats(prev => ({ ...prev, ...updatedStats }));
    } catch (error) {
      mergeStatsFallback({
        taskCompletionMinutes: (stats.taskCompletionMinutes || 0) + minutes,
      });
      showToast('Backend completion save failed, using local fallback.', 'warning');
    }
  };

  const updateTaskDate = (taskId, date) => {
    setTasks(prev => prev.map(task => task.id === taskId ? { ...task, date: date || '' } : task));
    setHistoryRecords(prev => prev.map(record => record.id === taskId ? { ...record, date: date || '', hasDueDate: Boolean(date), updatedAt: new Date().toISOString() } : record));
  };

  const deleteHistoryRecord = (taskId) => {
    setHistoryRecords(prev => prev.filter(record => record.id !== taskId));
    setHiddenHistoryIds(prev => prev.includes(taskId) ? prev : [...prev, taskId]);
    showToast('Historical record removed. The original task was kept.');
  };

  const selectTaskFromCalendar = (id) => {
    const task = tasks.find(t => t.id === id);
    setActiveTaskId(id);
    setPath(task?.children?.length ? [id] : []);
    setIsFocusedMode(false);
  };

  const deleteTask = (taskId) => {
    setTasks(tasks.filter(tk => tk.id !== taskId));
    if (activeTaskId === taskId) setActiveTaskId(null);
    showToast('Task deleted');
  };

  const toggleTask = (taskId) => {
    const target = tasks.find(tk => tk.id === taskId);
    const willComplete = target?.status !== 'done';

    setTasks(tasks.map(tk =>
      tk.id === taskId ? { ...tk, status: tk.status === 'done' ? 'pending' : 'done', progress: tk.status === 'done' ? 0 : 100 } : tk
    ));

    if (willComplete && target) handleTaskComplete(target);
  };

  const buildRootContextPayload = (root) => ({
    rootTitle: root?.title || '',
    rootDescription: root?.desc || '',
    originalTaskInput: root?.sourceContext?.originalTaskInput || '',
    fileName: root?.sourceContext?.fileName || null,
    fileMimeType: root?.sourceContext?.fileMimeType || null,
    fileSize: root?.sourceContext?.fileSize || null,
  });

  const getTreeContext = (targetId) => {
    const root = tasks.find((t) => t.id === activeTaskId) || tasks.find((t) => t.id === targetId);
    if (!root) return null;

    if (targetId === root.id) {
      return {
        root,
        targetNode: root,
        parentNode: null,
        siblingNodes: root.children || [],
        pathToTarget: [],
      };
    }

    let found = null;

    const walk = (list, parentNode, pathSoFar) => {
      for (const node of list || []) {
        if (node.id === targetId) {
          found = {
            root,
            targetNode: node,
            parentNode,
            siblingNodes: list || [],
            pathToTarget: [...pathSoFar, node.id],
          };
          return true;
        }
        if (node.children?.length && walk(node.children, node, [...pathSoFar, node.id])) {
          return true;
        }
      }
      return false;
    };

    walk(root.children || [], root, []);
    return found;
  };

  const ensureRootContext = async (root) => {
    if (root?.sourceContext?.contextId) {
      return {
        sourceContext: root.sourceContext,
        bootstrapResult: null,
      };
    }

    const seedText = [root?.title, root?.desc].filter(Boolean).join('\n\n').trim();
    const bootstrap = await postBreakdownRequest({
      mode: 'initial',
      taskInput: seedText,
      file: null,
    });

    const sourceContext = {
      contextId: bootstrap.contextId,
      originalTaskInput: seedText,
      fileName: null,
      fileMimeType: null,
      fileSize: null,
      hasFile: false,
    };

    setTasks((prev) =>
      prev.map((task) =>
        task.id === root.id
          ? {
              ...task,
              sourceContext,
              children: task.children?.length
                ? task.children
                : convertAiStepsToChildren(bootstrap.steps || [], task.id, bootstrap.source || 'gemma'),
            }
          : task
      )
    );

    return { sourceContext, bootstrapResult: bootstrap };
  };

  const handleInitialSend = async (overrideText) => {
    if (isAiWorking) return;

    const taskInput = typeof overrideText === 'string' ? overrideText : composerText;
    const trimmedInput = taskInput.trim();

    if (!trimmedInput && !composerFile) {
      showToast('Please enter a task or upload a file before sending.', 'warning');
      return;
    }

    const requestController = new AbortController();
    initialRequestControllerRef.current = requestController;

    try {
      setIsAiWorking(true);
      setToast(null);
      setSubmissionPreview({
        text: trimmedInput,
        fileName: composerFile?.name || null,
      });

      const filePayload = composerFile
        ? {
            name: composerFile.name,
            mimeType: composerFile.type || 'application/octet-stream',
            size: composerFile.size || 0,
            dataBase64: await fileToBase64(composerFile),
          }
        : null;

      const [result] = await Promise.all([
        postBreakdownRequest({
          mode: 'initial',
          taskInput: trimmedInput,
          file: filePayload,
        }, { signal: requestController.signal }),
        new Promise((resolve) => setTimeout(resolve, 450)),
      ]);

      const newTaskId = `task_${Date.now()}`;
      const newTask = {
        id: newTaskId,
        title: result.rootTitle || trimmedInput || stripExtension(composerFile?.name || 'Uploaded Task'),
        progress: 0,
        status: 'pending',
        date: '',
        desc: result.rootDescription || trimmedInput || 'No description provided.',
        children: convertAiStepsToChildren(result.steps || [], newTaskId, result.source || 'gemma'),
        sourceContext: {
          contextId: result.contextId,
          originalTaskInput: trimmedInput,
          fileName: composerFile?.name || null,
          fileMimeType: composerFile?.type || null,
          fileSize: composerFile?.size || null,
          hasFile: !!composerFile,
        },
      };

      setTasks((prev) => [newTask, ...prev]);
      setActiveTaskId(newTaskId);
      setPath([newTaskId]);
      setIsFocusedMode(true);
      setComposerText('');
      setComposerFile(null);
      setSubmissionPreview(null);
      showToast('Task broken into 3 subtasks');
    } catch (error) {
      if (error.name === 'AbortError') return;
      console.error(error);
      setSubmissionPreview(null);
      showToast(error.message || 'Local breakdown failed', 'warning');
    } finally {
      if (initialRequestControllerRef.current === requestController) {
        initialRequestControllerRef.current = null;
      }
      setIsAiWorking(false);
    }
  };

  const handleCancelInitialSend = () => {
    initialRequestControllerRef.current?.abort();
    initialRequestControllerRef.current = null;
    setIsAiWorking(false);
    setSubmissionPreview(null);
  };

  const handleOpenNode = (targetId) => {
    const ctx = getTreeContext(targetId);
    if (!ctx) return;

    if (targetId === ctx.root.id) {
      setPath([ctx.root.id]);
    } else {
      setPath([ctx.root.id, ...ctx.pathToTarget]);
    }

    setIsFocusedMode(true);
  };

  const handleBreakdown = async (taskIdToBreakdown) => {
    if (isAiWorking) return;

    const ctx = getTreeContext(taskIdToBreakdown);
    if (!ctx) return;

    try {
      setIsAiWorking(true);
      showToast('Asking Gemma 4… this may take ~30s', 'loading');

      const ensured = await ensureRootContext(ctx.root);
      const contextId = ensured.sourceContext.contextId;

      if (taskIdToBreakdown === ctx.root.id && ensured.bootstrapResult && !ctx.root.children?.length) {
        const aiChildren = convertAiStepsToChildren(ensured.bootstrapResult.steps || [], ctx.root.id, ensured.bootstrapResult.source || 'gemma');
        setTasks((prev) =>
          prev.map((task) =>
            task.id === ctx.root.id
              ? {
                  ...task,
                  children: aiChildren,
                  sourceContext: ensured.sourceContext,
                }
              : task
          )
        );
        setActiveTaskId(ctx.root.id);
        setPath([ctx.root.id]);
        setIsFocusedMode(true);
        showToast('Task broken into 3 subtasks');
        return;
      }

      const result = await postBreakdownRequest({
        mode: 'breakdown-node',
        contextId,
        rootContext: buildRootContextPayload(ctx.root),
        parentNode: ctx.parentNode
          ? { id: ctx.parentNode.id, title: ctx.parentNode.title, desc: ctx.parentNode.desc || '' }
          : { id: ctx.root.id, title: ctx.root.title, desc: ctx.root.desc || '' },
        targetNode: {
          id: ctx.targetNode.id,
          title: ctx.targetNode.title,
          desc: ctx.targetNode.desc || '',
        },
      });

      const aiChildren = convertAiStepsToChildren(result.steps || [], ctx.targetNode.id, result.source || 'gemma');

      setTasks((prev) =>
        prev.map((task) => {
          if (task.id !== ctx.root.id) return task;

          if (ctx.targetNode.id === ctx.root.id) {
            return {
              ...task,
              children: aiChildren,
              sourceContext: ensured.sourceContext,
            };
          }

          return {
            ...task,
            sourceContext: ensured.sourceContext,
            children: updateNodeById(task.children || [], ctx.targetNode.id, (node) => ({
              ...node,
              children: aiChildren,
            })),
          };
        })
      );

      setActiveTaskId(ctx.root.id);
      setPath(taskIdToBreakdown === ctx.root.id ? [ctx.root.id] : [ctx.root.id, ...ctx.pathToTarget]);
      setIsFocusedMode(true);
      showToast('Subtask broken into 3 child subtasks');
    } catch (error) {
      console.error(error);
      showToast(error.message || 'Local breakdown failed', 'warning');
    } finally {
      setIsAiWorking(false);
    }
  };

  const handleRegenerate = async (taskIdToRegenerate) => {
    if (isAiWorking) return;

    const ctx = getTreeContext(taskIdToRegenerate);
    if (!ctx) return;

    if (taskIdToRegenerate === ctx.root.id) {
      await handleBreakdown(taskIdToRegenerate);
      return;
    }

    try {
      setIsAiWorking(true);
      showToast('Asking Gemma 4… regenerating subtask', 'loading');

      const ensured = await ensureRootContext(ctx.root);
      const result = await postBreakdownRequest({
        mode: 'regenerate-node',
        contextId: ensured.sourceContext.contextId,
        rootContext: buildRootContextPayload(ctx.root),
        parentNode: ctx.parentNode
          ? { id: ctx.parentNode.id, title: ctx.parentNode.title, desc: ctx.parentNode.desc || '' }
          : { id: ctx.root.id, title: ctx.root.title, desc: ctx.root.desc || '' },
        targetNode: {
          id: ctx.targetNode.id,
          title: ctx.targetNode.title,
          desc: ctx.targetNode.desc || '',
          estimatedMinutes: ctx.targetNode.estimatedMinutes || 10,
        },
        siblingNodes: (ctx.siblingNodes || []).map((node) => ({
          id: node.id,
          title: node.title,
          desc: node.desc || '',
        })),
      });

      const slotIndex = Math.max(0, (ctx.siblingNodes || []).findIndex((node) => node.id === ctx.targetNode.id));
      const regeneratedNode = convertAiStepToNode(result.step, ctx.targetNode.id, result.source || 'gemma', slotIndex);

      setTasks((prev) =>
        prev.map((task) => {
          if (task.id !== ctx.root.id) return task;
          return {
            ...task,
            sourceContext: ensured.sourceContext,
            children: updateNodeById(task.children || [], ctx.targetNode.id, (existingNode) => ({
              ...regeneratedNode,
              children: existingNode.children || [],
            })),
          };
        })
      );

      showToast('Only that subtask was regenerated');
    } catch (error) {
      console.error(error);
      showToast(error.message || 'Regeneration failed', 'warning');
    } finally {
      setIsAiWorking(false);
    }
  };

  const handleReturnToRoot = () => {
    if (activeTaskId) {
      setPath([activeTaskId]);
    } else {
      setPath([]);
    }
    setIsFocusedMode(false);
  };

  const openRecovery = (taskId) => {
    setRecoveryActiveTaskId(taskId || activeRootTask?.id);
    setIsRecoveryOpen(true);
  };

  const generateRecovery = async (input) => {
    if (!activeRootTask) throw new Error('Select a plan before starting recovery.');
    return postReplanRequest(buildRecoveryContext(activeRootTask, input));
  };

  const applyRecovery = (proposal, input) => {
    if (!activeRootTask) return;
    const validation = validateRecoveryProposal(activeRootTask, proposal, Number(activeRootTask.planVersion) || 1);
    if (!validation.valid) {
      showToast(`This recovery plan is no longer valid: ${validation.errors[0]}`, 'warning');
      return;
    }
    try {
      const updatedRoot = applyRecoveryProposal(activeRootTask, proposal);
      const record = createRecoveryRecord(activeRootTask, proposal, input);
      setTasks((current) => current.map((task) => task.id === activeRootTask.id ? updatedRoot : task));
      setRecoveryHistory((current) => appendRecoveryHistory(current, record));
      setActiveTaskId(activeRootTask.id);
      const nextPath = proposal.nextStepId === updatedRoot.id
        ? []
        : findPathToNode(updatedRoot.children || [], proposal.nextStepId) || [];
      setPath([updatedRoot.id, ...nextPath]);
      setIsFocusedMode(true);
      setIsRecoveryOpen(false);
      showToast('Plan repaired. Your new next step is ready.');
    } catch (error) {
      showToast(error.message || 'The recovery plan could not be applied.', 'warning');
    }
  };

  const undoLatestRecovery = () => {
    if (!activeRootTask) return;
    const record = recoveryHistory.find((item) => item.rootTaskId === activeRootTask.id);
    if (!record?.beforeSnapshot) {
      showToast('There is no recovery to undo for this plan.', 'warning');
      return;
    }
    setTasks((current) => current.map((task) => task.id === activeRootTask.id ? record.beforeSnapshot : task));
    setRecoveryHistory((current) => current.filter((item) => item.id !== record.id));
    setPath([activeRootTask.id]);
    setIsRecoveryOpen(false);
    showToast('The last recovery was undone.');
  };


  return (
    <div className={`flex h-screen w-full font-sans overflow-hidden selection:bg-indigo-500/30 transition-colors duration-300 ${t.bgApp} ${t.textMain}`}>
      {showSplash && (
        <div className="fc-splash" aria-label="FocusTrail is starting">
          <div className="fc-splash-lockup">
            <img className="fc-splash-logo" src={`/logo-animated.svg?play=${splashKey}`} alt="FocusTrail" />
            <div className="fc-splash-name">FocusTrail</div>
            <div className="fc-splash-slogan" aria-label="Attention Drifts. Here's Direction.">
              <span>A</span>ttention <span>D</span>rifts. <span>H</span>ere’s <span>D</span>irection.
            </div>
            <div className="fc-splash-tagline">偏离之后，带你回到下一步</div>
          </div>
        </div>
      )}
      
      {/* ================= LEFT SIDEBAR ================= */}
      <nav className={`flex flex-col items-center py-6 ${t.bgPanel} ${t.border} border-r transition-colors duration-300 z-40 shrink-0 relative`}
        style={{ width: isFocusedMode ? 64 : navCollapsed ? 56 : navWidth }}>
        
        {/* 右侧拖拽条 */}
        {!isFocusedMode && !navCollapsed && (
          <div
            className="absolute right-0 top-0 bottom-0 w-1.5 cursor-col-resize z-50 group"
            onMouseDown={(e) => {
              e.preventDefault();
              const startX = e.clientX;
              const startW = navWidth;
              const onMove = (ev) => {
                const diff = ev.clientX - startX;
                setNavWidth(Math.max(60, Math.min(280, startW + diff)));
              };
              const onUp = () => { document.removeEventListener('mousemove', onMove); document.removeEventListener('mouseup', onUp); };
              document.addEventListener('mousemove', onMove);
              document.addEventListener('mouseup', onUp);
            }}
          >
            <div className={`w-0.5 h-full mx-auto transition-colors group-hover:bg-indigo-500/50 ${t.border}`}></div>
          </div>
        )}
        {/* Logo + 折叠按钮 */}
        <div className={`flex items-center mb-8 px-3 w-full ${navCollapsed || isFocusedMode ? 'justify-center' : 'justify-between'}`}>
          <button type="button" onClick={replaySplash} className={`flex items-center gap-2 ${t.textMain}`} title="Replay FocusTrail intro">
            <img src="/logo.svg" alt="FocusTrail" className="w-8 h-8 shrink-0 object-contain" />
            {!navCollapsed && !isFocusedMode && navWidth > 130 && <span className="text-base font-bold tracking-tight whitespace-nowrap">FocusTrail</span>}
          </button>
          {!isFocusedMode && !navCollapsed && navWidth > 130 && (
            <button
              onClick={() => setNavCollapsed(true)}
              className={`flex h-7 w-7 items-center justify-center rounded-full transition-colors ${t.textMuted} hover:bg-indigo-500/10 hover:text-indigo-500`}
              aria-label="Collapse menu"
              title="Collapse menu"
            >
              <ChevronLeft className="h-4 w-4" strokeWidth={2} />
            </button>
          )}
        </div>
        {/* 折叠时：同一套方向箭头展开 */}
        {navCollapsed && !isFocusedMode && (
          <button
            onClick={() => setNavCollapsed(false)}
            className={`mb-4 flex h-8 w-8 items-center justify-center rounded-full transition-colors ${t.textMuted} hover:bg-indigo-500/10 hover:text-indigo-500`}
            aria-label="Expand menu"
            title="Expand menu"
          >
            <ChevronRight className="h-4 w-4" strokeWidth={2} />
          </button>
        )}

        {/* Nav Items */}
        <div className="flex flex-col gap-3 w-full px-3">
          <NavItem t={t} icon={<CalendarIcon/>} label="Calendar" active={activePanel === 'calendar'} isFocusedMode={isFocusedMode} showLabel={!navCollapsed && navWidth > 120} onClick={() => setActivePanel(activePanel === 'calendar' ? null : 'calendar')} />
          <NavItem t={t} icon={<BarChart2/>} label="Statistics" active={activePanel === 'stats'} isFocusedMode={isFocusedMode} showLabel={!navCollapsed && navWidth > 120} onClick={() => setActivePanel(activePanel === 'stats' ? null : 'stats')} />
          <NavItem t={t} icon={<Activity/>} label="Monitor" active={activePanel === 'monitor'} isFocusedMode={isFocusedMode} showLabel={!navCollapsed && navWidth > 120} onClick={() => setActivePanel(activePanel === 'monitor' ? null : 'monitor')} />
          <NavItem t={t} icon={<SettingsIcon/>} label="Settings" active={activePanel === 'settings'} isFocusedMode={isFocusedMode} showLabel={!navCollapsed && navWidth > 120} onClick={() => setActivePanel(activePanel === 'settings' ? null : 'settings')} />
        </div>

        <div className="flex-grow" />

        {/* Reward Progress Orb */}
        <div className="mb-4 flex flex-col items-center w-full px-2 overflow-hidden">
          <button
            type="button"
            onClick={openRewards}
            className={`group relative w-10 h-10 rounded-xl flex items-center justify-center border shadow-sm transition-transform active:scale-95 mx-auto ${theme === 'dark' ? 'bg-[#1c202a] border-white/5' : 'bg-white border-slate-200'} ${nearReward ? 'ring-2 ring-indigo-500/25' : ''}`}
            title="Rewards progress"
          >
            <ProgressRing percent={rewardProgress} theme={theme} size={40} stroke={4} />
            <div className="absolute inset-0 flex items-center justify-center">
              <Zap className={`w-3.5 h-3.5 ${theme === 'dark' ? 'text-indigo-300' : 'text-indigo-700'} ${nearReward ? 'drop-shadow-[0_0_10px_rgba(99,102,241,0.35)]' : ''}`} />
            </div>
          </button>

          {!isFocusedMode && !navCollapsed && navWidth > 130 && (
            <div className="text-center mt-2 text-xs font-bold text-indigo-500">
              {formatMins(stats.focusScore)} <span className={t.textMuted}>/ {formatMins(rewardBounds.next)}</span>
            </div>
          )}
          {!isFocusedMode && !navCollapsed && navWidth > 130 && (
            <div className={`text-center mt-1 text-[10px] font-semibold ${t.textMuted}`}>
              {userLevel.name}
            </div>
          )}
        </div>
      </nav>

      {/* LEFT PANELS OVERLAYS */}
      <LeftPanels
        t={t} theme={theme} activePanel={activePanel} close={() => setActivePanel(null)}
        stats={stats} tasks={tasks} settings={settings} setSettings={setSettings}
        onSelectTask={selectTaskFromCalendar}
        onCreateTask={(title, date) => createNewTask(title, date)}
        onUpdateTaskDate={updateTaskDate}
        onDeleteHistoryRecord={deleteHistoryRecord}
        onDeleteTask={deleteTask}
        onToggleTask={toggleTask}
        historyRecords={historyRecords}
        activeTaskId={activeTaskId}
        showToast={showToast}
      />

      {/* ================= MAIN CANVAS ================= */}
      <main className="flex-1 min-w-0 flex flex-col relative overflow-hidden">
        
        {/* Top Header / Breadcrumbs */}
        {activeTaskId && (
          <header className={`h-16 flex items-center justify-between px-6 md:px-10 border-b ${t.border} ${theme === 'dark' ? 'bg-[#0f1115]/80' : 'bg-slate-50/80'} backdrop-blur-md z-10 shrink-0`}>
             <div className="flex items-center gap-2 text-sm font-medium">
                <button 
                  onClick={() => { setActiveTaskId(null); setPath([]); setIsFocusedMode(false); }} 
                  className={`flex items-center gap-1 ${t.textMuted} hover:text-indigo-500 transition-colors`}
                >
                  <Home className="w-4 h-4" /> Home
                </button>
                
                {path.length >= 0 && (
                  <>
                    <ChevronRight className={`w-4 h-4 ${t.textMuted}`} />
                    <button 
                      onClick={handleReturnToRoot}
                      className={`truncate max-w-[120px] transition-colors ${path.length === 0 ? 'text-indigo-500 font-bold' : `${t.textMuted} hover:text-indigo-500`}`}
                    >
                      {activeRootTask?.title}
                    </button>
                  </>
                )}

                {(path.length > 0 && path[0] === activeRootTask?.id ? path.slice(1) : path).map((stepId, index, normalizedPath) => {
                  let stepTitle = 'Subtask';
                  let list = activeRootTask?.children || [];
                  for (let i = 0; i <= index; i++) {
                    const node = list.find(n => n.id === normalizedPath[i]);
                    if (node) {
                      stepTitle = node.title;
                      list = node.children || [];
                    }
                  }
                  const isLast = index === normalizedPath.length - 1;
                  return (
                    <React.Fragment key={stepId}>
                      <ChevronRight className={`w-4 h-4 ${t.textMuted}`} />
                      <button 
                        onClick={() => {
                          const base = path.length > 0 && path[0] === activeRootTask?.id ? [activeRootTask.id] : [];
                          setPath([...base, ...normalizedPath.slice(0, index + 1)]);
                        }}
                        className={`truncate max-w-[150px] transition-colors ${isLast ? 'text-indigo-500 font-bold' : `${t.textMuted} hover:text-indigo-500`}`}
                      >
                        {stepTitle}
                      </button>
                    </React.Fragment>
                  );
                })}
             </div>

             <div className="flex items-center gap-3">
               <button onClick={() => {setActiveTaskId(null); setPath([]); setIsFocusedMode(false);}} className={`text-xs px-3 py-1.5 rounded-lg ${t.secondaryBtn}`}>
                 Clear Active Task
               </button>
             </div>
          </header>
        )}

        {/* Dynamic Views */}
        <div className="flex-1 min-w-0 overflow-y-auto p-4 sm:p-6 md:p-10 flex flex-col relative custom-scrollbar">
          
          {/* STATE A: No Pending Task */}
          {!activeTaskId && (
            <ViewA
              t={t}
              theme={theme}
              value={composerText}
              onValueChange={setComposerText}
              file={composerFile}
              onFileSelect={setComposerFile}
              onFileClear={() => setComposerFile(null)}
              onSubmit={handleInitialSend}
              isSubmitting={isAiWorking}
              submissionPreview={submissionPreview}
              onCancelSubmission={handleCancelInitialSend}
              webDemoMode={WEB_DEMO_MODE}
            />
          )}

          {/* STATE B: Active Task Overview */}
          {activeTaskId && path.length === 0 && (
            <ViewB
              t={t}
              theme={theme}
              task={activeRootTask}
              onBreakdown={() => handleBreakdown(activeRootTask.id)}
              tasks={tasks}
              onSwitchTask={(id) => { setActiveTaskId(id); setPath([]); }}
              isWorking={isAiWorking}
              onOpenMonitor={() => setActivePanel('monitor')}
              onOpenRecovery={() => openRecovery(activeRootTask.id)}
            />
          )}

          {/* STATE C & E: Breakdown & Focus Views */}
          {activeTaskId && path.length > 0 && (
            <ViewCE 
              t={t} theme={theme}
              rootTask={activeRootTask} 
              path={path}
              onBreakdown={handleBreakdown}
              onRegenerate={handleRegenerate}
              onOpenNode={handleOpenNode}
              showToast={showToast}
              onTaskComplete={handleTaskComplete}
              onFocusSessionComplete={handleFocusSessionComplete}
              onOpenRecovery={openRecovery}
            />
          )}
        </div>
      </main>

      {/* ================= RIGHT SIDEBAR: QUICK NOTES ================= */}
      {isNotesSidebarOpen && !isFocusedMode && (
        <aside className={`flex-col border-l z-10 shrink-0 hidden lg:flex relative ${t.bgPanel} ${t.border}`}
          style={{ width: notesSidebarWidth }}
        >
          {/* 左边拖拽条 */}
          <div
            className="absolute left-0 top-0 bottom-0 w-2 cursor-col-resize z-20 group -ml-1"
            onMouseDown={(e) => {
              e.preventDefault();
              const startX = e.clientX;
              const startW = notesSidebarWidth;
              const onMove = (ev) => {
                const diff = startX - ev.clientX;
                const newW = Math.max(200, Math.min(500, startW + diff));
                setNotesSidebarWidth(newW);
              };
              const onUp = () => { document.removeEventListener('mousemove', onMove); document.removeEventListener('mouseup', onUp); };
              document.addEventListener('mousemove', onMove);
              document.addEventListener('mouseup', onUp);
            }}
          >
            <div className={`w-0.5 h-full mx-auto transition-colors group-hover:bg-indigo-500 ${t.border}`}></div>
          </div>
          <QuickNotesPanel t={t} theme={theme} notes={notes} setNotes={setNotes} onClose={() => setIsNotesSidebarOpen(false)} />
        </aside>
      )}
      {isFocusedMode && (
        <aside className={`flex flex-col border-l transition-all duration-300 z-10 shrink-0 w-16 cursor-pointer ${t.bgPanel} ${t.border} ${theme === 'dark' ? 'hover:bg-white/5' : 'hover:bg-slate-100'}`}
               onClick={() => setIsFocusedMode(false)}>
          <div className={`flex flex-col items-center py-6 h-full ${t.textMuted}`}>
            <Edit3 className="w-5 h-5 mb-4" />
            <div className="writing-vertical-rl text-[10px] tracking-[0.2em] uppercase opacity-50">Quick Notes</div>
          </div>
        </aside>
      )}
      {/* Desktop: Quick Notes 关闭后的小按钮，点击重新打开 */}
      {!isNotesSidebarOpen && !isFocusedMode && (
        <button
          onClick={() => setIsNotesSidebarOpen(true)}
          className={`fixed top-4 right-4 z-30 hidden lg:flex p-2.5 rounded-xl shadow-lg border transition-colors ${t.bgPanel} ${t.border} ${t.textMuted} hover:text-indigo-400 hover:border-indigo-500/50`}
          title="Open Quick Notes"
        >
          <Edit3 className="w-4 h-4" />
        </button>
      )}

      {/* Mobile/Tablet: Quick Notes FAB + Drawer (so notes work below lg) */}
      <button
        onClick={() => setIsNotesOpen(true)}
        className={`fixed bottom-6 right-6 lg:hidden z-30 p-4 rounded-2xl shadow-xl border transition-colors ${t.bgPanel} ${t.border} ${t.textMain} hover:border-indigo-500/40 hover:bg-indigo-500/5`}
        aria-label="Open Quick Notes"
        title="Quick Notes"
      >
        <Edit3 className="w-5 h-5" />
      </button>

      {isNotesOpen && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <div
            className="absolute inset-0 bg-black/30 backdrop-blur-sm"
            onClick={() => setIsNotesOpen(false)}
          />
          <div className={`absolute right-0 top-0 bottom-0 w-full max-w-md border-l shadow-2xl flex flex-col ${t.bgPanel} ${t.border} animate-slide-up`}>
            <div className={`p-6 flex items-center justify-between border-b ${t.border}`}>
              <h3 className={`font-bold text-lg ${t.textMain}`}>Quick Notes</h3>
              <button
                onClick={() => setIsNotesOpen(false)}
                className={`p-2 rounded-xl transition-colors ${t.textMuted} ${theme === 'dark' ? 'hover:bg-white/5' : 'hover:bg-slate-100'}`}
                aria-label="Close Quick Notes"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="p-6 flex-1 overflow-y-auto custom-scrollbar">
              <QuickNotesPanel t={t} theme={theme} notes={notes} setNotes={setNotes} showHeader={false} />
            </div>
          </div>
        </div>
      )}

      <RewardProgressModal open={isRewardsOpen} onClose={closeRewards} t={t} theme={theme} stats={stats} />
      <RecoveryPlanModal
        key={`${activeRootTask?.id || 'none'}-${isRecoveryOpen ? 'open' : 'closed'}`}
        open={isRecoveryOpen}
        rootTask={activeRootTask}
        activeTaskId={recoveryActiveTaskId || activeRootTask?.id}
        t={t}
        onClose={() => setIsRecoveryOpen(false)}
        onGenerate={generateRecovery}
        onApply={applyRecovery}
        onUndo={undoLatestRecovery}
        canUndo={Boolean(activeRootTask && recoveryHistory.some((item) => item.rootTaskId === activeRootTask.id))}
      />

      {/* Global Toast */}
      {toast && (
        <div className="fixed bottom-6 right-6 md:left-1/2 md:-translate-x-1/2 md:right-auto z-50 animate-fade-in">
          <div className={`px-4 py-3 rounded-xl shadow-2xl flex items-center gap-3 text-sm font-medium border ${theme === 'dark' ? 'bg-[#2a2e38] border-white/10 text-white' : 'bg-gray-900 border-gray-800 text-white'}`}>
            {toast.type === 'loading' ? (
              <span className="w-4 h-4 rounded-full border-2 border-indigo-400 border-t-transparent animate-spin shrink-0" />
            ) : toast.type === 'success' ? (
              <CheckCircle className="w-4 h-4 text-emerald-400 shrink-0" />
            ) : (
              <ShieldAlert className="w-4 h-4 text-amber-400 shrink-0" />
            )}
            {toast.msg}
          </div>
        </div>
      )}

    </div>
  );
}

// ==========================================
// VIEW COMPONENTS
// ==========================================
