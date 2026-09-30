import { useEffect, useRef, useState, type FormEvent } from 'react'
import { useFocusTrap } from '../hooks/useFocusTrap'
import type { AmapKeySource } from '../services/amapKeyConfig'

interface AmapKeySetupDialogProps {
  open: boolean
  initialPage: 'config' | 'guide'
  configured: boolean
  source: AmapKeySource
  isSaving: boolean
  error: string
  onSave: (key: string) => Promise<boolean>
  onClose: () => void
}

function sourceLabel(source: AmapKeySource): string {
  if (source === 'environment') return '环境变量'
  if (source === 'local-config') return '本机应用配置'
  return '未配置'
}

function AmapKeySetupDialog({
  open,
  initialPage,
  configured,
  source,
  isSaving,
  error,
  onSave,
  onClose,
}: AmapKeySetupDialogProps) {
  const [keyDraft, setKeyDraft] = useState('')
  const [showKey, setShowKey] = useState(false)
  const [page, setPage] = useState<'config' | 'guide'>(initialPage)
  const dialogRef = useRef<HTMLElement | null>(null)
  useFocusTrap(dialogRef, open)

  useEffect(() => {
    if (!open) return
    setKeyDraft('')
    setShowKey(false)
    setPage(initialPage)
  }, [open, initialPage])

  if (!open) return null

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const saved = await onSave(keyDraft)
    if (saved) setKeyDraft('')
  }

  return (
    <div className="amap-key-dialog-backdrop" role="presentation">
      <section
        ref={dialogRef}
        className="amap-key-dialog amap-key-dialog-with-guide"
        role="dialog"
        aria-modal="true"
        aria-labelledby="amap-key-dialog-title"
      >
        <div className="amap-key-dialog-header">
          <div>
            <h2 id="amap-key-dialog-title">配置地图服务</h2>
            <p>地点联想和路线规划需要高德 Web 服务 Key。</p>
          </div>
          <button type="button" className={page === 'guide' ? 'amap-key-dialog-close amap-key-guide-skip' : 'amap-key-dialog-close'} onClick={onClose} disabled={isSaving} aria-label={page === 'guide' ? '跳过教程' : '关闭配置窗口'}>
            {page === 'guide' ? '跳过' : '×'}
          </button>
        </div>

        <nav className="amap-key-pages" aria-label="地图服务页面">
          <button type="button" aria-current={page === 'config' ? 'page' : undefined} onClick={() => setPage('config')} disabled={isSaving}>Key 配置</button>
          <button type="button" aria-current={page === 'guide' ? 'page' : undefined} onClick={() => setPage('guide')} disabled={isSaving}>API 注册方法</button>
        </nav>

        {page === 'guide' ? (
          <div className="amap-key-guide">
            <div className="amap-key-guide-intro">
              <h3>第一次使用？先申请自己的地图 Key</h3>
              <p>Key 是高德提供的地图服务凭证，用于地点搜索和路线规划。按下面 4 步申请，再复制到软件中即可。</p>
            </div>
            <ol className="amap-key-guide-steps">
              <li><div><h4>注册并登录高德开放平台</h4><p>打开高德开放平台，注册开发者账号并登录控制台。如页面要求认证，请按官网提示完成。</p><a href="https://lbs.amap.com/" target="_blank" rel="noopener noreferrer">打开高德开放平台 ↗</a></div></li>
              <li><div><h4>在「应用管理」中创建应用</h4><p>进入「应用管理」→「我的应用」，点击「创建新应用」。名称可填写“我的旅行轨迹”，其余信息按实际用途填写。</p></div></li>
              <li><div><h4>添加 Key，服务平台选择「Web 服务」</h4><p>找到刚创建的应用，点击「添加 Key」，填写名称并选择服务平台，然后提交。</p><p className="amap-key-guide-important">请选择「Web 服务」，不要选「Web 端（JS API）」、Android 或 iOS。本软件填写的是 Key，无需填写 JS API 的安全密钥。</p></div></li>
              <li><div><h4>复制 Key，回到这里保存</h4><p>复制新建的 Key，切换到「Key 配置」，粘贴并点击「保存并启用」。随后即可尝试搜索地点或规划路线。</p></div></li>
            </ol>
            <p className="amap-key-dialog-note">请妥善保管自己的 Key。账号认证、服务权限及调用额度以高德控制台为准。若保存后仍无法规划，请先核对 Key 的服务平台和可用额度。</p>
            <a className="amap-key-guide-reference" href="https://lbs.amap.com/api/webservice/create-project-and-key" target="_blank" rel="noopener noreferrer">查看高德官方申请说明 ↗</a>
            <p className="amap-key-dialog-note">可以先跳过，稍后从「地图服务」→「API 注册方法」重新查看。未配置时，地点联想和路线规划暂不可用。</p>
            <div className="amap-key-dialog-actions">
              <button type="button" className="btn-secondary" onClick={onClose}>跳过，先体验</button>
              <button type="button" className="btn-primary" onClick={() => setPage('config')}>已有 Key，去配置</button>
            </div>
          </div>
        ) : (
          <>

        <p className="amap-key-dialog-status">
          当前状态：{configured ? `已配置（${sourceLabel(source)}）` : '未配置'}
        </p>

        <form onSubmit={submit}>
          <label className="amap-key-field">
            高德 Web 服务 Key
            <div className="amap-key-input-row">
              <input
                type={showKey ? 'text' : 'password'}
                value={keyDraft}
                onChange={(event) => setKeyDraft(event.target.value)}
                placeholder={configured ? '输入新的 Key 可替换当前配置' : '请输入高德 Web 服务 Key'}
                autoComplete="off"
                spellCheck={false}
                disabled={isSaving}
                autoFocus
              />
              <button type="button" onClick={() => setShowKey((current) => !current)} disabled={isSaving}>
                {showKey ? '隐藏' : '显示'}
              </button>
            </div>
          </label>

          <p className="amap-key-dialog-note">
            Key 仅发送到本机后端。桌面版会保存在当前 Windows 用户的应用数据目录，不会写入旅程备份。
          </p>
          {error && <p className="amap-key-dialog-error">{error}</p>}

          <div className="amap-key-dialog-actions">
            <button type="button" className="btn-secondary" onClick={onClose} disabled={isSaving}>
              稍后设置
            </button>
            <button type="submit" className="btn-primary" disabled={isSaving || !keyDraft.trim()}>
              {isSaving ? '保存中...' : configured ? '替换 Key' : '保存并启用'}
            </button>
          </div>
        </form>
          </>
        )}
      </section>
    </div>
  )
}

export default AmapKeySetupDialog
