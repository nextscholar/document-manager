import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Rocket,
  CheckCircle2,
  AlertCircle,
  ArrowRight,
  ArrowLeft,
  Server,
  FolderOpen,
  Zap,
  FileType,
  Play,
  Loader2,
  RefreshCw,
  Info,
  Settings,
  ChevronDown,
  ChevronUp,
  Plus,
  Copy,
  Check,
  Terminal,
  HelpCircle,
  ExternalLink,
  Eye,
  EyeOff,
  Cloud
} from 'lucide-react'
import styles from './Setup.module.css'

// Cloud provider model options (all non-Ollama providers that need an API key in setup)
const CLOUD_PROVIDER_MODELS = {
  openai: {
    displayName: 'OpenAI',
    chat: ['gpt-4o', 'gpt-4o-mini', 'gpt-4-turbo', 'gpt-3.5-turbo'],
    embedding: ['text-embedding-3-small', 'text-embedding-3-large', 'text-embedding-ada-002'],
    defaultChat: 'gpt-4o-mini',
    defaultEmbedding: 'text-embedding-3-small',
    apiKeyLink: 'https://platform.openai.com/api-keys',
    apiKeyLabel: 'OpenAI Dashboard'
  },
  anthropic: {
    displayName: 'Anthropic',
    chat: ['claude-3-5-sonnet-20241022', 'claude-3-5-haiku-20241022', 'claude-3-opus-20240229', 'claude-3-haiku-20240307'],
    embedding: [],
    defaultChat: 'claude-3-haiku-20240307',
    defaultEmbedding: '',
    apiKeyLink: 'https://console.anthropic.com/settings/keys',
    apiKeyLabel: 'Anthropic Console'
  },
  qwen: {
    displayName: 'Qwen (Alibaba)',
    chat: ['qwen-max', 'qwen-plus', 'qwen-turbo', 'qwen-long', 'qwen-max-latest'],
    embedding: ['text-embedding-v3'],
    defaultChat: 'qwen-plus',
    defaultEmbedding: 'text-embedding-v3',
    apiKeyLink: 'https://dashscope.console.aliyun.com/apiKey',
    apiKeyLabel: 'DashScope Console'
  },
  deepseek: {
    displayName: 'DeepSeek',
    chat: ['deepseek-chat', 'deepseek-reasoner'],
    embedding: [],
    defaultChat: 'deepseek-chat',
    defaultEmbedding: '',
    apiKeyLink: 'https://platform.deepseek.com/api_keys',
    apiKeyLabel: 'DeepSeek Platform'
  },
  zhipu: {
    displayName: 'Zhipu AI (GLM)',
    chat: ['glm-4-plus', 'glm-4-air', 'glm-4-flash', 'glm-4v'],
    embedding: ['embedding-3'],
    defaultChat: 'glm-4-air',
    defaultEmbedding: 'embedding-3',
    apiKeyLink: 'https://open.bigmodel.cn/usercenter/apikeys',
    apiKeyLabel: 'Zhipu Open Platform'
  }
}

// Chinese cloud providers that are shown in their own section
const CHINESE_PROVIDERS = ['qwen', 'deepseek', 'zhipu']

const API_BASE = '/api'

// Step definitions
const STEPS = [
  { id: 'welcome', title: 'Welcome', icon: Rocket },
  { id: 'health', title: 'System Check', icon: CheckCircle2 },
  { id: 'llm', title: 'LLM Provider', icon: Server },
  { id: 'sources', title: 'Source Folders', icon: FolderOpen },
  { id: 'indexing', title: 'Indexing Mode', icon: Zap },
  { id: 'extensions', title: 'File Types', icon: FileType },
  { id: 'start', title: 'Start Processing', icon: Play }
]

function Setup() {
  const navigate = useNavigate()
  const [currentStep, setCurrentStep] = useState(0)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  
  // Health check data
  const [healthData, setHealthData] = useState(null)
  const [healthLoading, setHealthLoading] = useState(false)
  
  // First-run data
  const [firstRunData, setFirstRunData] = useState(null)
  
  // LLM Settings
  const [llmProvider, setLlmProvider] = useState('ollama')
  const [ollamaModels, setOllamaModels] = useState([])
  const [selectedModel, setSelectedModel] = useState('')
  const [selectedEmbeddingModel, setSelectedEmbeddingModel] = useState('nomic-embed-text')
  const [loadingModels, setLoadingModels] = useState(false)
  
  // Cloud provider settings (Qwen, DeepSeek, Zhipu)
  const [cloudApiKey, setCloudApiKey] = useState('')
  const [cloudChatModel, setCloudChatModel] = useState('')
  const [cloudEmbeddingModel, setCloudEmbeddingModel] = useState('')
  const [showCloudApiKey, setShowCloudApiKey] = useState(false)
  
  // Source folders
  const [availableMounts, setAvailableMounts] = useState([])
  const [selectedFolders, setSelectedFolders] = useState([])
  const [sourcesData, setSourcesData] = useState({ include: [], exclude: [] })
  
  // Indexing mode
  const [indexingMode, setIndexingMode] = useState('fast_scan')
  
  // File types
  const [extensions, setExtensions] = useState([])
  const [extensionPreset, setExtensionPreset] = useState('documents')
  
  // Advanced panel visibility
  const [showAdvanced, setShowAdvanced] = useState(false)
  
  // Environment variable overrides
  const [envOverrides, setEnvOverrides] = useState({})

  useEffect(() => {
    loadInitialData()
  }, [])

  const loadInitialData = async () => {
    setLoading(true)
    try {
      // Check first-run status
      const firstRunRes = await fetch(`${API_BASE}/system/first-run`)
      if (firstRunRes.ok) {
        const data = await firstRunRes.json()
        setFirstRunData(data)
        
        // If setup is already complete, redirect to home
        if (data.setup_complete) {
          navigate('/')
          return
        }
        
        // Pre-populate with current settings
        setIndexingMode(data.indexing_mode || 'fast_scan')
        if (data.current_settings?.source_folders) {
          setSelectedFolders(data.current_settings.source_folders)
        }
        if (data.current_settings?.extensions) {
          setExtensions(data.current_settings.extensions)
        }
      }
      
      // Load available mounts
      const mountsRes = await fetch(`${API_BASE}/settings/sources/mounts`)
      if (mountsRes.ok) {
        const data = await mountsRes.json()
        setAvailableMounts(data.mounts || [])
      }
      
      // Load sources
      const sourcesRes = await fetch(`${API_BASE}/settings/sources`)
      if (sourcesRes.ok) {
        const data = await sourcesRes.json()
        setSourcesData(data)
        if (data.include?.length > 0) {
          setSelectedFolders(data.include)
        }
      }
      
      // Load extensions
      const extRes = await fetch(`${API_BASE}/settings/extensions`)
      if (extRes.ok) {
        const data = await extRes.json()
        if (data.extensions?.length > 0) {
          setExtensions(data.extensions)
        }
      }
      
      // Load env overrides
      const envRes = await fetch(`${API_BASE}/settings/env-overrides`)
      if (envRes.ok) {
        const data = await envRes.json()
        setEnvOverrides(data.overrides || {})
      }
      
      // Run health check
      await runHealthCheck()
      
      // Load Ollama models
      await loadOllamaModels()
      
    } catch (err) {
      console.error('Failed to load initial data:', err)
    }
    setLoading(false)
  }

  const runHealthCheck = async () => {
    setHealthLoading(true)
    try {
      const res = await fetch(`${API_BASE}/system/health-check`)
      if (res.ok) {
        setHealthData(await res.json())
      }
    } catch (err) {
      console.error('Health check failed:', err)
    }
    setHealthLoading(false)
  }
  
  // Check if a setting path is set by env var
  const isEnvSet = (path) => envOverrides[path]?.locked === true
  const getEnvVarName = (path) => envOverrides[path]?.env_var
  const hasAnyEnvOverrides = () => Object.keys(envOverrides).length > 0

  const loadOllamaModels = async () => {
    setLoadingModels(true)
    try {
      const res = await fetch(`${API_BASE}/settings/ollama/models`)
      if (res.ok) {
        const data = await res.json()
        const models = Array.isArray(data) ? data : (data.models || [])
        setOllamaModels(models)
        
        // Auto-select first chat model if none selected
        if (!selectedModel && models.length > 0) {
          const chatModel = models.find(m => !m.name?.includes('embed')) || models[0]
          setSelectedModel(chatModel.name || chatModel)
        }
        
        // Auto-select embedding model
        const embedModel = models.find(m => m.name?.includes('embed') || m.name?.includes('nomic'))
        if (embedModel) {
          setSelectedEmbeddingModel(embedModel.name || embedModel)
        }
      }
    } catch (err) {
      console.error('Failed to load models:', err)
    }
    setLoadingModels(false)
  }

  const selectCloudProvider = (provider) => {
    const cfg = CLOUD_PROVIDER_MODELS[provider]
    if (cfg) {
      // Only reset model selections when switching to a different provider
      if (provider !== llmProvider) {
        setCloudChatModel(cfg.defaultChat)
        setCloudEmbeddingModel(cfg.defaultEmbedding)
      }
    }
    setLlmProvider(provider)
    setShowCloudApiKey(false)
  }

  const toggleFolder = (folder) => {
    setSelectedFolders(prev => 
      prev.includes(folder)
        ? prev.filter(f => f !== folder)
        : [...prev, folder]
    )
  }

  const applyExtensionPreset = (preset) => {
    setExtensionPreset(preset)
    switch (preset) {
      case 'documents':
        setExtensions(['.txt', '.md', '.html', '.pdf', '.docx'])
        break
      case 'images':
        setExtensions(['.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp', '.tiff', '.tif'])
        break
      case 'everything':
        setExtensions([
          '.txt', '.md', '.html', '.pdf', '.docx',
          '.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp', '.tiff', '.tif'
        ])
        break
      default:
        break
    }
  }

  const saveSettings = async () => {
    setSaving(true)
    try {
      // Save source folders
      await fetch(`${API_BASE}/settings/sources`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          include: selectedFolders,
          exclude: sourcesData.exclude || []
        })
      })
      
      // Save extensions
      await fetch(`${API_BASE}/settings/extensions`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ extensions })
      })
      
      // Save indexing mode
      await fetch(`${API_BASE}/settings`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ indexing_mode: indexingMode })
      })
      
      // If a model was selected, update LLM settings
      if (llmProvider === 'ollama' && selectedModel) {
        const llmRes = await fetch(`${API_BASE}/settings/llm`)
        if (llmRes.ok) {
          const current = await llmRes.json()
          await fetch(`${API_BASE}/settings/llm`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              ...current,
              provider: llmProvider,
              ollama: {
                ...current.ollama,
                model: selectedModel,
                embedding_model: selectedEmbeddingModel
              }
            })
          })
        }
      } else if (Object.keys(CLOUD_PROVIDER_MODELS).includes(llmProvider) && cloudApiKey) {
        const llmRes = await fetch(`${API_BASE}/settings/llm`)
        if (llmRes.ok) {
          const current = await llmRes.json()
          const providerConfig = {
            ...current[llmProvider],
            api_key: cloudApiKey,
            model: cloudChatModel
          }
          if (cloudEmbeddingModel) {
            providerConfig.embedding_model = cloudEmbeddingModel
          }
          await fetch(`${API_BASE}/settings/llm`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              ...current,
              provider: llmProvider,
              [llmProvider]: providerConfig
            })
          })
        }
      }
      
    } catch (err) {
      console.error('Failed to save settings:', err)
    }
    setSaving(false)
  }

  const completeSetup = async () => {
    setSaving(true)
    try {
      // Save all settings first
      await saveSettings()
      
      // Mark setup as complete
      const res = await fetch(`${API_BASE}/system/complete-setup`, { method: 'POST' })
      if (res.ok) {
        // Start the worker
        await fetch(`${API_BASE}/worker/state`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ running: true })
        })
        
        // Navigate to dashboard
        navigate('/dashboard')
      }
    } catch (err) {
      console.error('Failed to complete setup:', err)
    }
    setSaving(false)
  }

  const nextStep = () => {
    if (currentStep < STEPS.length - 1) {
      setCurrentStep(currentStep + 1)
    }
  }

  const prevStep = () => {
    if (currentStep > 0) {
      setCurrentStep(currentStep - 1)
    }
  }

  const canProceed = () => {
    switch (STEPS[currentStep].id) {
      case 'health':
        // Allow proceeding even with warnings, but not errors
        return healthData && healthData.status !== 'error'
      case 'sources':
        return selectedFolders.length > 0
      case 'extensions':
        return extensions.length > 0
      default:
        return true
    }
  }

  const getStatusColor = (status) => {
    switch (status) {
      case 'ok': return styles.statusOk
      case 'warning': return styles.statusWarning
      case 'error': return styles.statusError
      default: return ''
    }
  }

  const getStatusIcon = (status) => {
    switch (status) {
      case 'ok': return <CheckCircle2 size={18} />
      case 'warning': return <AlertCircle size={18} />
      case 'error': return <AlertCircle size={18} />
      default: return null
    }
  }

  // Render step content
  const renderStepContent = () => {
    const step = STEPS[currentStep]
    
    switch (step.id) {
      case 'welcome':
        return (
          <div className={styles.stepContent}>
            <div className={styles.welcomeHero}>
              <Rocket size={64} className={styles.heroIcon} />
              <h1>Welcome to Archive Brain</h1>
              <p className={styles.heroSubtitle}>
                Let's get your document archive set up. This wizard will guide you through
                configuring your system for optimal performance.
              </p>
            </div>
            
            <div className={styles.welcomeFeatures}>
              <div className={styles.feature}>
                <Server size={24} />
                <div>
                  <h3>Smart Indexing</h3>
                  <p>Automatically extract and organize content from your documents</p>
                </div>
              </div>
              <div className={styles.feature}>
                <Zap size={24} />
                <div>
                  <h3>Semantic Search</h3>
                  <p>Find documents by meaning, not just keywords</p>
                </div>
              </div>
              <div className={styles.feature}>
                <FolderOpen size={24} />
                <div>
                  <h3>Your Data, Your Control</h3>
                  <p>Everything runs locally - your documents never leave your machine</p>
                </div>
              </div>
            </div>
            
            {firstRunData?.has_files && (
              <div className={styles.infoBox}>
                <Info size={20} />
                <span>
                  We detected {firstRunData.file_count.toLocaleString()} existing files.
                  This wizard will help you configure how they're processed.
                </span>
              </div>
            )}
          </div>
        )
      
      case 'health':
        return (
          <div className={styles.stepContent}>
            <h2>System Health Check</h2>
            <p className={styles.stepDescription}>
              Checking your system configuration to ensure everything is ready.
            </p>
            
            {healthLoading ? (
              <div className={styles.loadingState}>
                <Loader2 size={32} className={styles.spinner} />
                <span>Running health checks...</span>
              </div>
            ) : healthData ? (
              <>
                <div className={`${styles.overallStatus} ${getStatusColor(healthData.status)}`}>
                  {getStatusIcon(healthData.status)}
                  <span>
                    {healthData.status === 'ok' && 'All systems ready!'}
                    {healthData.status === 'warning' && 'System ready with some warnings'}
                    {healthData.status === 'error' && 'Some issues need attention'}
                  </span>
                </div>
                
                <div className={styles.healthChecks}>
                  {Object.entries(healthData.checks).map(([key, check]) => (
                    <div key={key} className={`${styles.healthCheck} ${getStatusColor(check.status)}`}>
                      <div className={styles.healthCheckHeader}>
                        {getStatusIcon(check.status)}
                        <span className={styles.healthCheckName}>
                          {key.charAt(0).toUpperCase() + key.slice(1)}
                        </span>
                      </div>
                      <p className={styles.healthCheckMessage}>{check.message}</p>
                      {check.fix && (
                        <p className={styles.healthCheckFix}>
                          <strong>Fix:</strong> {check.fix}
                        </p>
                      )}
                    </div>
                  ))}
                </div>
                
                <button 
                  className={styles.refreshButton}
                  onClick={runHealthCheck}
                  disabled={healthLoading}
                >
                  <RefreshCw size={16} />
                  Re-run Checks
                </button>
              </>
            ) : (
              <div className={styles.errorState}>
                <AlertCircle size={32} />
                <span>Failed to run health check</span>
                <button onClick={runHealthCheck}>Retry</button>
              </div>
            )}
          </div>
        )
      
      case 'llm':
        return (
          <div className={styles.stepContent}>
            <h2>LLM Configuration</h2>
            <p className={styles.stepDescription}>
              Select which AI model provider to use for document analysis.
            </p>
            
            {/* Self-Hosted */}
            <h3 className={styles.sectionTitle}>🖥️ Self-Hosted</h3>
            <div className={styles.providerCards}>
              <div 
                className={`${styles.providerCard} ${llmProvider === 'ollama' ? styles.selected : ''}`}
                onClick={() => setLlmProvider('ollama')}
              >
                <Server size={32} />
                <h3>Ollama (Local)</h3>
                <p>Run models locally on your hardware. Private and free.</p>
                {llmProvider === 'ollama' && <CheckCircle2 className={styles.checkmark} />}
              </div>
            </div>

            {/* Cloud APIs */}
            <h3 className={styles.sectionTitle}>☁️ Cloud APIs</h3>
            <div className={styles.providerCards}>
              <div 
                className={`${styles.providerCard} ${llmProvider === 'openai' ? styles.selected : ''}`}
                onClick={() => selectCloudProvider('openai')}
              >
                <Zap size={32} />
                <h3>OpenAI</h3>
                <p>GPT-4o, GPT-4, embeddings. Requires API key.</p>
                {llmProvider === 'openai' && <CheckCircle2 className={styles.checkmark} />}
              </div>
              <div 
                className={`${styles.providerCard} ${llmProvider === 'anthropic' ? styles.selected : ''}`}
                onClick={() => selectCloudProvider('anthropic')}
              >
                <Cloud size={32} />
                <h3>Anthropic</h3>
                <p>Claude 3.5 Sonnet, Claude 3 Haiku. Requires API key.</p>
                {llmProvider === 'anthropic' && <CheckCircle2 className={styles.checkmark} />}
              </div>
            </div>

            {/* Chinese Cloud APIs */}
            <h3 className={styles.sectionTitle}>🇨🇳 Chinese Cloud APIs</h3>
            <div className={styles.providerCards}>
              <div 
                className={`${styles.providerCard} ${llmProvider === 'qwen' ? styles.selected : ''}`}
                onClick={() => selectCloudProvider('qwen')}
              >
                <Zap size={32} />
                <h3>Qwen (Alibaba)</h3>
                <p>Qwen-Max, Qwen-Plus — chat &amp; embeddings. Requires API key.</p>
                {llmProvider === 'qwen' && <CheckCircle2 className={styles.checkmark} />}
              </div>
              <div 
                className={`${styles.providerCard} ${llmProvider === 'deepseek' ? styles.selected : ''}`}
                onClick={() => selectCloudProvider('deepseek')}
              >
                <Zap size={32} />
                <h3>DeepSeek</h3>
                <p>DeepSeek-Chat (V3), DeepSeek-Reasoner (R1). Requires API key.</p>
                {llmProvider === 'deepseek' && <CheckCircle2 className={styles.checkmark} />}
              </div>
              <div 
                className={`${styles.providerCard} ${llmProvider === 'zhipu' ? styles.selected : ''}`}
                onClick={() => selectCloudProvider('zhipu')}
              >
                <Cloud size={32} />
                <h3>Zhipu AI (GLM)</h3>
                <p>GLM-4-Plus, GLM-4-Air — chat &amp; embeddings. Requires API key.</p>
                {llmProvider === 'zhipu' && <CheckCircle2 className={styles.checkmark} />}
              </div>
            </div>
            
            {/* Ollama model selection */}
            {llmProvider === 'ollama' && (
              <div className={styles.modelSelection}>
                <h3>Select Models</h3>
                
                {/* Env override notice */}
                {(isEnvSet('ollama.model') || isEnvSet('ollama.embedding_model')) && (
                  <div className={styles.infoBox}>
                    <Info size={20} />
                    <span>
                      Some models are pre-configured via environment variables. 
                      You can change them here or keep the defaults.
                    </span>
                  </div>
                )}
                
                {loadingModels ? (
                  <div className={styles.loadingState}>
                    <Loader2 size={24} className={styles.spinner} />
                    <span>Loading available models...</span>
                  </div>
                ) : ollamaModels.length > 0 ? (
                  <>
                    <div className={styles.formGroup}>
                      <label>
                        Chat Model
                        {isEnvSet('ollama.model') && (
                          <span className={styles.envBadge} title={`Default from ${getEnvVarName('ollama.model')}`}>
                            ENV
                          </span>
                        )}
                      </label>
                      <select 
                        value={selectedModel}
                        onChange={(e) => setSelectedModel(e.target.value)}
                      >
                        {ollamaModels.map(model => (
                          <option key={model.name || model} value={model.name || model}>
                            {model.name || model}
                          </option>
                        ))}
                      </select>
                      <span className={styles.hint}>Used for generating summaries and tags</span>
                    </div>
                    
                    <div className={styles.formGroup}>
                      <label>
                        Embedding Model
                        {isEnvSet('ollama.embedding_model') && (
                          <span className={styles.envBadge} title={`Default from ${getEnvVarName('ollama.embedding_model')}`}>
                            ENV
                          </span>
                        )}
                      </label>
                      <select 
                        value={selectedEmbeddingModel}
                        onChange={(e) => setSelectedEmbeddingModel(e.target.value)}
                      >
                        {ollamaModels.map(model => (
                          <option key={model.name || model} value={model.name || model}>
                            {model.name || model}
                          </option>
                        ))}
                      </select>
                      <span className={styles.hint}>Used for semantic search (nomic-embed-text recommended)</span>
                    </div>
                  </>
                ) : (
                  <div className={styles.warningBox}>
                    <AlertCircle size={20} />
                    <div>
                      <p>No models found in Ollama.</p>
                      <p className={styles.hint}>
                        Pull a model first: <code>ollama pull phi4-mini</code>
                      </p>
                    </div>
                  </div>
                )}
                
                <button 
                  className={styles.refreshButton}
                  onClick={loadOllamaModels}
                  disabled={loadingModels}
                >
                  <RefreshCw size={16} />
                  Refresh Models
                </button>
              </div>
            )}

            {/* Cloud provider configuration */}
            {Object.keys(CLOUD_PROVIDER_MODELS).includes(llmProvider) && (() => {
              const cfg = CLOUD_PROVIDER_MODELS[llmProvider]
              return (
                <div className={styles.modelSelection}>
                  <h3>Configure {cfg.displayName}</h3>

                  <div className={styles.formGroup}>
                    <label>API Key</label>
                    <div className={styles.apiKeyInput}>
                      <input
                        type={showCloudApiKey ? 'text' : 'password'}
                        value={cloudApiKey}
                        onChange={e => setCloudApiKey(e.target.value)}
                        placeholder="Enter your API key…"
                      />
                      <button
                        type="button"
                        className={styles.apiKeyToggle}
                        onClick={() => setShowCloudApiKey(v => !v)}
                        title={showCloudApiKey ? 'Hide key' : 'Show key'}
                      >
                        {showCloudApiKey ? <EyeOff size={16} /> : <Eye size={16} />}
                      </button>
                    </div>
                    <span className={styles.hint}>
                      Get your API key from{' '}
                      <a href={cfg.apiKeyLink} target="_blank" rel="noopener noreferrer">
                        {cfg.apiKeyLabel} <ExternalLink size={12} />
                      </a>
                    </span>
                  </div>

                  <div className={styles.formGroup}>
                    <label>Chat Model</label>
                    <select
                      value={cloudChatModel}
                      onChange={e => setCloudChatModel(e.target.value)}
                    >
                      {cfg.chat.map(m => (
                        <option key={m} value={m}>{m}</option>
                      ))}
                    </select>
                    <span className={styles.hint}>Used for generating summaries and tags</span>
                  </div>

                  {cfg.embedding.length > 0 && (
                    <div className={styles.formGroup}>
                      <label>Embedding Model</label>
                      <select
                        value={cloudEmbeddingModel}
                        onChange={e => setCloudEmbeddingModel(e.target.value)}
                      >
                        {cfg.embedding.map(m => (
                          <option key={m} value={m}>{m}</option>
                        ))}
                      </select>
                      <span className={styles.hint}>Used for semantic search</span>
                    </div>
                  )}

                  {(llmProvider === 'deepseek' || llmProvider === 'anthropic') && (
                    <div className={styles.infoBox}>
                      <Info size={20} />
                      <span>
                        {cfg.displayName} does not provide an embedding API.
                        Semantic search will use your Ollama embedding model as a fallback.
                      </span>
                    </div>
                  )}
                </div>
              )
            })()}
          </div>
        )
      
      case 'sources':
        return (
          <div className={styles.stepContent}>
            <h2>Source Folders</h2>
            <p className={styles.stepDescription}>
              Select which folders to index. These are folders from your computer that have been mapped into the application.
            </p>
            
            {/* Available Mounts */}
            {availableMounts.length > 0 && (
              <>
                <h3 className={styles.sectionTitle}>Available Folders</h3>
                <div className={styles.folderList}>
                  {availableMounts.map(mount => (
                    <div 
                      key={mount.path}
                      className={`${styles.folderItem} ${selectedFolders.includes(mount.path) ? styles.selected : ''}`}
                      onClick={() => toggleFolder(mount.path)}
                    >
                      <div className={styles.folderCheckbox}>
                        {selectedFolders.includes(mount.path) && <CheckCircle2 size={20} />}
                      </div>
                      <FolderOpen size={24} />
                      <div className={styles.folderInfo}>
                        <span className={styles.folderPath}>{mount.path}</span>
                        <span className={styles.folderMeta}>
                          {mount.file_count?.toLocaleString() || 0} files
                          {mount.subdir_count > 0 && ` • ${mount.subdir_count} subfolder(s)`}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              </>
            )}
            
            {selectedFolders.length > 0 && (
              <div className={styles.infoBox}>
                <Info size={20} />
                <div>
                  <span>{selectedFolders.length} folder(s) selected for indexing</span>
                  <p className={styles.infoBoxHint}>
                    Changes take effect automatically — no restart required. The worker will pick up new folders on its next scan cycle.
                  </p>
                </div>
              </div>
            )}
            
            {/* Add More Folders Section */}
            <div className={styles.addFoldersSection}>
              <h3 className={styles.sectionTitle}>
                <Plus size={18} />
                Add More Folders from Your Computer
              </h3>
              
              <div className={styles.addFolderGuide}>
                <p>
                  To index folders from your computer, you need to map them into the Docker containers. 
                  This is a one-time setup that ensures the application can securely access your files.
                </p>
                
                <div className={styles.guideOptions}>
                  {/* Option 1: Quick Script */}
                  <div className={styles.guideOption}>
                    <div className={styles.guideOptionHeader}>
                      <Terminal size={20} />
                      <h4>Option 1: Use Helper Script (Easiest)</h4>
                    </div>
                    <p>Run this command in your project directory:</p>
                    <div className={styles.codeBlock}>
                      <code>./scripts/add-folder.sh /path/to/your/folder</code>
                      <button 
                        className={styles.copyButton}
                        onClick={() => {
                          navigator.clipboard.writeText('./scripts/add-folder.sh /path/to/your/folder')
                        }}
                        title="Copy to clipboard"
                      >
                        <Copy size={14} />
                      </button>
                    </div>
                    <p className={styles.guideHint}>
                      The script will update docker-compose.yml and restart the containers automatically.
                    </p>
                  </div>
                  
                  {/* Option 2: Manual */}
                  <div className={styles.guideOption}>
                    <div className={styles.guideOptionHeader}>
                      <Settings size={20} />
                      <h4>Option 2: Manual Configuration</h4>
                    </div>
                    <ol className={styles.guideSteps}>
                      <li>Open <code>docker-compose.yml</code> in your project folder</li>
                      <li>Find the <code>worker:</code> and <code>api:</code> services</li>
                      <li>Add your folder under the <code>volumes:</code> section of <strong>both</strong> services:</li>
                    </ol>
                    <div className={styles.codeBlock}>
                      <code>- /your/folder/path:/data/archive/foldername</code>
                      <button 
                        className={styles.copyButton}
                        onClick={() => {
                          navigator.clipboard.writeText('- /your/folder/path:/data/archive/foldername')
                        }}
                        title="Copy to clipboard"
                      >
                        <Copy size={14} />
                      </button>
                    </div>
                    <ol className={styles.guideSteps} start={4}>
                      <li>Save the file and restart:
                        <div className={styles.codeBlock}>
                          <code>docker compose down && docker compose up -d</code>
                          <button 
                            className={styles.copyButton}
                            onClick={() => {
                              navigator.clipboard.writeText('docker compose down && docker compose up -d')
                            }}
                            title="Copy to clipboard"
                          >
                            <Copy size={14} />
                          </button>
                        </div>
                      </li>
                      <li>Refresh this page - your folder will appear above</li>
                    </ol>
                  </div>
                </div>
                
                {/* Platform-specific examples */}
                <div className={styles.platformExamples}>
                  <h4><HelpCircle size={16} /> Path Examples by Platform</h4>
                  
                  <div className={styles.platformExample}>
                    <span className={styles.platformLabel}>Windows (via WSL/Docker Desktop):</span>
                    <div className={styles.codeBlock}>
                      <code>- /mnt/c/Users/YourName/Documents:/data/archive/documents</code>
                      <button 
                        className={styles.copyButton}
                        onClick={() => navigator.clipboard.writeText('- /mnt/c/Users/YourName/Documents:/data/archive/documents')}
                        title="Copy to clipboard"
                      >
                        <Copy size={14} />
                      </button>
                    </div>
                    <span className={styles.platformNote}>
                      Windows paths use <code>/mnt/c/</code> for C: drive, <code>/mnt/d/</code> for D: drive, etc.
                    </span>
                  </div>
                  
                  <div className={styles.platformExample}>
                    <span className={styles.platformLabel}>macOS:</span>
                    <div className={styles.codeBlock}>
                      <code>- /Users/yourname/Documents:/data/archive/documents</code>
                      <button 
                        className={styles.copyButton}
                        onClick={() => navigator.clipboard.writeText('- /Users/yourname/Documents:/data/archive/documents')}
                        title="Copy to clipboard"
                      >
                        <Copy size={14} />
                      </button>
                    </div>
                  </div>
                  
                  <div className={styles.platformExample}>
                    <span className={styles.platformLabel}>Linux:</span>
                    <div className={styles.codeBlock}>
                      <code>- /home/yourname/Documents:/data/archive/documents</code>
                      <button 
                        className={styles.copyButton}
                        onClick={() => navigator.clipboard.writeText('- /home/yourname/Documents:/data/archive/documents')}
                        title="Copy to clipboard"
                      >
                        <Copy size={14} />
                      </button>
                    </div>
                  </div>
                  
                  <div className={styles.platformExample}>
                    <span className={styles.platformLabel}>Network/NAS Drive:</span>
                    <div className={styles.codeBlock}>
                      <code>- /mnt/nas/shared:/data/archive/nas-files</code>
                      <button 
                        className={styles.copyButton}
                        onClick={() => navigator.clipboard.writeText('- /mnt/nas/shared:/data/archive/nas-files')}
                        title="Copy to clipboard"
                      >
                        <Copy size={14} />
                      </button>
                    </div>
                    <span className={styles.platformNote}>
                      Ensure the network drive is mounted on your host system first.
                    </span>
                  </div>
                </div>
                
                <button 
                  className={styles.refreshButton}
                  onClick={async () => {
                    const res = await fetch(`${API_BASE}/settings/sources/mounts`)
                    if (res.ok) {
                      const data = await res.json()
                      setAvailableMounts(data.mounts || [])
                    }
                  }}
                >
                  <RefreshCw size={16} />
                  Refresh Available Folders
                </button>
              </div>
            </div>
          </div>
        )
      
      case 'indexing':
        return (
          <div className={styles.stepContent}>
            <h2>Indexing Strategy</h2>
            <p className={styles.stepDescription}>
              Choose how deeply to analyze your documents. You can change this later.
            </p>
            
            <div className={styles.indexingOptions}>
              <div 
                className={`${styles.indexingOption} ${indexingMode === 'fast_scan' ? styles.selected : ''}`}
                onClick={() => setIndexingMode('fast_scan')}
              >
                <div className={styles.optionHeader}>
                  <Zap size={24} />
                  <div>
                    <h3>Fast Scan</h3>
                    <span className={styles.badge}>Recommended</span>
                  </div>
                  {indexingMode === 'fast_scan' && <CheckCircle2 className={styles.checkmark} />}
                </div>
                <p>Extract text and create embeddings only. Minimal LLM calls for quick indexing.</p>
                <ul className={styles.optionDetails}>
                  <li>✓ Text extraction</li>
                  <li>✓ Semantic search</li>
                  <li>✗ AI-generated titles</li>
                  <li>✗ Summaries & tags</li>
                </ul>
                <span className={styles.optionTiming}>~10 min for 10,000 files</span>
              </div>
              
              <div 
                className={`${styles.indexingOption} ${indexingMode === 'full_enrichment' ? styles.selected : ''}`}
                onClick={() => setIndexingMode('full_enrichment')}
              >
                <div className={styles.optionHeader}>
                  <Settings size={24} />
                  <h3>Full Enrichment</h3>
                  {indexingMode === 'full_enrichment' && <CheckCircle2 className={styles.checkmark} />}
                </div>
                <p>Complete AI analysis including titles, summaries, tags, and themes.</p>
                <ul className={styles.optionDetails}>
                  <li>✓ Text extraction</li>
                  <li>✓ Semantic search</li>
                  <li>✓ AI-generated titles</li>
                  <li>✓ Summaries & tags</li>
                </ul>
                <span className={styles.optionTiming}>~2-4 hours for 10,000 files</span>
              </div>
              
              <div 
                className={`${styles.indexingOption} ${indexingMode === 'custom' ? styles.selected : ''}`}
                onClick={() => {
                  setIndexingMode('custom')
                  setShowAdvanced(true)
                }}
              >
                <div className={styles.optionHeader}>
                  <Settings size={24} />
                  <h3>Custom</h3>
                  {indexingMode === 'custom' && <CheckCircle2 className={styles.checkmark} />}
                </div>
                <p>Fine-tune which processing steps to enable.</p>
                <span className={styles.optionTiming}>Configurable in Dashboard</span>
              </div>
            </div>
            
            {indexingMode === 'custom' && (
              <div className={styles.advancedPanel}>
                <button 
                  className={styles.advancedToggle}
                  onClick={() => setShowAdvanced(!showAdvanced)}
                >
                  {showAdvanced ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                  Advanced Options
                </button>
                
                {showAdvanced && (
                  <div className={styles.advancedContent}>
                    <p className={styles.hint}>
                      Custom processing options can be configured from the Dashboard after setup.
                    </p>
                  </div>
                )}
              </div>
            )}
          </div>
        )
      
      case 'extensions':
        return (
          <div className={styles.stepContent}>
            <h2>File Types</h2>
            <p className={styles.stepDescription}>
              Select which file types to index.
            </p>
            
            <div className={styles.presetButtons}>
              <button 
                className={`${styles.presetButton} ${extensionPreset === 'documents' ? styles.selected : ''}`}
                onClick={() => applyExtensionPreset('documents')}
              >
                Documents Only
              </button>
              <button 
                className={`${styles.presetButton} ${extensionPreset === 'images' ? styles.selected : ''}`}
                onClick={() => applyExtensionPreset('images')}
              >
                Images Only
              </button>
              <button 
                className={`${styles.presetButton} ${extensionPreset === 'everything' ? styles.selected : ''}`}
                onClick={() => applyExtensionPreset('everything')}
              >
                Everything
              </button>
            </div>
            
            <div className={styles.extensionsList}>
              <h4>Selected Extensions</h4>
              <div className={styles.extensionTags}>
                {extensions.map(ext => (
                  <span key={ext} className={styles.extensionTag}>
                    {ext}
                  </span>
                ))}
              </div>
            </div>
            
            <div className={styles.infoBox}>
              <Info size={20} />
              <span>You can add more file types later from Settings.</span>
            </div>
          </div>
        )
      
      case 'start':
        return (
          <div className={styles.stepContent}>
            <h2>Ready to Start!</h2>
            <p className={styles.stepDescription}>
              Review your settings and start processing.
            </p>
            
            <div className={styles.summaryCard}>
              <h3>Configuration Summary</h3>
              
              <div className={styles.summaryRow}>
                <span className={styles.summaryLabel}>LLM Provider</span>
                <span className={styles.summaryValue}>
                  {llmProvider === 'ollama'
                    ? 'Ollama (Local)'
                    : (CLOUD_PROVIDER_MODELS[llmProvider]?.displayName ?? llmProvider)}
                </span>
              </div>
              
              {llmProvider === 'ollama' && selectedModel && (
                <div className={styles.summaryRow}>
                  <span className={styles.summaryLabel}>Chat Model</span>
                  <span className={styles.summaryValue}>{selectedModel}</span>
                </div>
              )}

              {Object.keys(CLOUD_PROVIDER_MODELS).includes(llmProvider) && cloudChatModel && (
                <div className={styles.summaryRow}>
                  <span className={styles.summaryLabel}>Chat Model</span>
                  <span className={styles.summaryValue}>{cloudChatModel}</span>
                </div>
              )}

              {Object.keys(CLOUD_PROVIDER_MODELS).includes(llmProvider) && cloudEmbeddingModel && (
                <div className={styles.summaryRow}>
                  <span className={styles.summaryLabel}>Embedding Model</span>
                  <span className={styles.summaryValue}>{cloudEmbeddingModel}</span>
                </div>
              )}
              
              <div className={styles.summaryRow}>
                <span className={styles.summaryLabel}>Source Folders</span>
                <span className={styles.summaryValue}>{selectedFolders.length} folder(s)</span>
              </div>
              
              <div className={styles.summaryRow}>
                <span className={styles.summaryLabel}>Indexing Mode</span>
                <span className={styles.summaryValue}>
                  {indexingMode === 'fast_scan' && 'Fast Scan'}
                  {indexingMode === 'full_enrichment' && 'Full Enrichment'}
                  {indexingMode === 'custom' && 'Custom'}
                </span>
              </div>
              
              <div className={styles.summaryRow}>
                <span className={styles.summaryLabel}>File Types</span>
                <span className={styles.summaryValue}>{extensions.length} type(s)</span>
              </div>
            </div>
            
            <div className={styles.startActions}>
              <button 
                className={styles.startButton}
                onClick={completeSetup}
                disabled={saving}
              >
                {saving ? (
                  <>
                    <Loader2 size={20} className={styles.spinner} />
                    Starting...
                  </>
                ) : (
                  <>
                    <Play size={20} />
                    Start Processing
                  </>
                )}
              </button>
              
              <p className={styles.hint}>
                Processing will begin in the background. You can monitor progress from the Dashboard.
              </p>
            </div>
          </div>
        )
      
      default:
        return null
    }
  }

  if (loading) {
    return (
      <div className={styles.loadingContainer}>
        <Loader2 size={48} className={styles.spinner} />
        <span>Loading setup wizard...</span>
      </div>
    )
  }

  return (
    <div className={styles.setupContainer}>
      {/* Progress sidebar */}
      <div className={styles.sidebar}>
        <div className={styles.sidebarHeader}>
          <Rocket size={24} />
          <span>Setup Wizard</span>
        </div>
        
        <div className={styles.stepList}>
          {STEPS.map((step, index) => (
            <div 
              key={step.id}
              className={`${styles.stepItem} ${index === currentStep ? styles.active : ''} ${index < currentStep ? styles.completed : ''}`}
              onClick={() => index <= currentStep && setCurrentStep(index)}
            >
              <div className={styles.stepIndicator}>
                {index < currentStep ? (
                  <CheckCircle2 size={20} />
                ) : (
                  <span>{index + 1}</span>
                )}
              </div>
              <span className={styles.stepTitle}>{step.title}</span>
            </div>
          ))}
        </div>
      </div>
      
      {/* Main content */}
      <div className={styles.mainContent}>
        <div className={styles.stepWrapper}>
          {renderStepContent()}
        </div>
        
        {/* Navigation */}
        <div className={styles.navigation}>
          <button 
            className={styles.navButton}
            onClick={prevStep}
            disabled={currentStep === 0}
          >
            <ArrowLeft size={20} />
            Back
          </button>
          
          <div className={styles.stepProgress}>
            Step {currentStep + 1} of {STEPS.length}
          </div>
          
          {currentStep < STEPS.length - 1 && (
            <button 
              className={`${styles.navButton} ${styles.primary}`}
              onClick={nextStep}
              disabled={!canProceed()}
            >
              Next
              <ArrowRight size={20} />
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

export default Setup
