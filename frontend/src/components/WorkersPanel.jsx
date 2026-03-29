import { useState, useEffect } from 'react';
import styles from './WorkersPanel.module.css';

const STATUS_ICONS = {
  starting: '🔄',
  active: '🟢',
  idle: '🟡',
  stale: '🔴',
  stopped: '⚫'
};

const PHASE_LABELS = {
  ingest: 'Ingesting',
  segment: 'Segmenting',
  enrich: 'Enriching',
  enrich_docs: 'Enriching Docs',
  embed: 'Embedding',
  embed_docs: 'Embedding Docs'
};

function WorkerItem({ worker }) {
  const statusIcon = STATUS_ICONS[worker.status] || '❓';
  const phaseLabel = worker.current_phase ? PHASE_LABELS[worker.current_phase] || worker.current_phase : null;

  // Prefer active LLM info stored by the worker loop (reflects Settings changes)
  // over the static Ollama server name from worker registration.
  const activeLLMProvider = worker.active_llm_provider;
  const activeModel = worker.active_model;
  const activeEmbedModel = worker.active_embedding_model;

  // Build a human-readable model label
  const modelLabel = activeLLMProvider
    ? `${activeLLMProvider}${activeModel ? ` / ${activeModel}` : ''}`
    : worker.ollama_server_name || null;
  
  const formatTime = (isoString) => {
    if (!isoString) return 'Never';
    const date = new Date(isoString);
    const now = new Date();
    const diffMs = now - date;
    const diffSec = Math.floor(diffMs / 1000);
    
    if (diffSec < 60) return `${diffSec}s ago`;
    if (diffSec < 3600) return `${Math.floor(diffSec / 60)}m ago`;
    return `${Math.floor(diffSec / 3600)}h ago`;
  };

  return (
    <div className={`${styles.workerItem} ${styles[worker.status]}`}>
      <div className={styles.workerHeader}>
        <span className={styles.statusIcon}>{statusIcon}</span>
        <span className={styles.workerName}>{worker.name}</span>
        {worker.managed && <span className={styles.managedBadge}>Managed</span>}
      </div>
      
      <div className={styles.workerDetails}>
        {modelLabel && (
          <span className={styles.serverInfo}>
            🤖 {modelLabel}
          </span>
        )}

        {activeEmbedModel && (
          <span className={styles.serverInfo}>
            📐 {activeEmbedModel}
          </span>
        )}
        
        {phaseLabel && worker.status === 'active' && (
          <span className={styles.phaseInfo}>
            ⚙️ {phaseLabel}
          </span>
        )}
        
        {worker.stats?.docs_per_min > 0 && (
          <span className={styles.rateInfo}>
            📊 {worker.stats.docs_per_min.toFixed(1)}/min
          </span>
        )}
        
        {worker.stats?.memory_mb && (
          <span className={styles.memoryInfo}>
            💾 {worker.stats.memory_mb.toFixed(0)} MB
          </span>
        )}
      </div>
      
      <div className={styles.workerFooter}>
        <span className={styles.heartbeat}>
          Last seen: {formatTime(worker.last_heartbeat)}
        </span>
      </div>
    </div>
  );
}

export default function WorkersPanel({ compact = false, refreshInterval = 10000 }) {
  const [workers, setWorkers] = useState([]);
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [collapsed, setCollapsed] = useState(false);

  const fetchWorkers = async () => {
    try {
      const [workersRes, statsRes] = await Promise.all([
        fetch('/api/workers/active'),
        fetch('/api/workers/stats')
      ]);
      
      if (workersRes.ok) {
        const data = await workersRes.json();
        setWorkers(data.workers || []);
      }
      
      if (statsRes.ok) {
        const data = await statsRes.json();
        setStats(data);
      }
      
      setError(null);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchWorkers();
    const interval = setInterval(fetchWorkers, refreshInterval);
    return () => clearInterval(interval);
  }, [refreshInterval]);

  const activeCount = workers.filter(w => w.status === 'active').length;
  const idleCount = workers.filter(w => w.status === 'idle').length;

  if (loading && workers.length === 0) {
    return (
      <div className={styles.panel}>
        <div className={styles.header}>
          <h3>🖥️ Workers</h3>
        </div>
        <div className={styles.loading}>Loading...</div>
      </div>
    );
  }

  return (
    <div className={`${styles.panel} ${compact ? styles.compact : ''}`}>
      <div className={styles.header} onClick={() => setCollapsed(!collapsed)}>
        <h3>
          🖥️ Workers
          <span className={styles.count}>
            {activeCount > 0 && <span className={styles.activeCount}>{activeCount} active</span>}
            {idleCount > 0 && <span className={styles.idleCount}>{idleCount} idle</span>}
          </span>
        </h3>
        <button className={styles.collapseBtn}>
          {collapsed ? '▶' : '▼'}
        </button>
      </div>

      {!collapsed && (
        <div className={styles.content}>
          {error && (
            <div className={styles.error}>Error: {error}</div>
          )}

          {workers.length === 0 ? (
            <div className={styles.noWorkers}>
              <p>No active workers</p>
              <p className={styles.hint}>
                Workers will appear here once they start processing
              </p>
            </div>
          ) : (
            <>
              {stats && stats.total_docs_per_min > 0 && (
                <div className={styles.throughput}>
                  <span className={styles.throughputLabel}>Total throughput:</span>
                  <span className={styles.throughputValue}>
                    {stats.total_docs_per_min.toFixed(1)} docs/min
                  </span>
                </div>
              )}
              
              <div className={styles.workersList}>
                {workers.map(worker => (
                  <WorkerItem key={worker.id} worker={worker} />
                ))}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
