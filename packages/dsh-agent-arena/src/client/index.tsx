import React, { useEffect, useMemo, useState } from 'react'
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import type {} from '@deepseek-ai/dsh-api-remotes/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type {} from '@deepseek-ai/dsh-client-ui-slots'
import arenaRemote from 'dsh-agent-arena/remote'
import type { ArenaConfig, ArenaMatch, ArenaStatus, Contestant, ContestantResult, ValidationCommand } from '../models.ts'
import styles from './arena.module.css'

export const inject = ['remote', 'slots']
const MIN_CONTESTANTS = 2
const MAX_CONTESTANTS = 4
const MAX_VALIDATIONS = 12
const DEFAULT_TIMEOUT = 300_000

type RemoteResult<T> = { ok: true; value: T } | { ok: false; error: { message: string } }
type RawApi = { list(limit: number): Promise<RemoteResult<ArenaMatch[]>>; start(input: ArenaConfig): Promise<RemoteResult<ArenaMatch>>; cancel(id: string): Promise<RemoteResult<ArenaMatch>>; applyWinner(id: string): Promise<RemoteResult<ArenaMatch>> }
type Api = { list(limit: number): Promise<ArenaMatch[]>; start(input: ArenaConfig): Promise<ArenaMatch>; cancel(id: string): Promise<ArenaMatch>; applyWinner(id: string): Promise<ArenaMatch> }
type Notice = { tone: 'success' | 'info'; message: string }

const statusLabels: Record<ArenaStatus, string> = { queued: '等待开始', preparing: '准备隔离环境', running: '选手执行中', validating: '正在验证', scoring: '正在评分', completed: '已完成', cancelled: '已取消', failed: '失败' }
const makeContestant = (index: number): Contestant => ({ id: `contestant-${index + 1}`, label: `选手 ${index + 1}`, provider: '', model: '' })
const initialValidation: ValidationCommand[] = [{ command: 'git status --porcelain=v1', weight: 1, timeoutMs: DEFAULT_TIMEOUT }]

async function unwrap<T>(pending: Promise<RemoteResult<T>>): Promise<T> { const result = await pending; if (!result.ok) throw new Error(result.error.message); return result.value }
function apiFrom(raw: RawApi): Api { return { list: limit => unwrap(raw.list(limit)), start: input => unwrap(raw.start(input)), cancel: id => unwrap(raw.cancel(id)), applyWinner: id => unwrap(raw.applyWinner(id)) } }
function problem(command: string): string | undefined { if (!command.trim()) return '请输入验证命令。'; return /["'`$|;&<>\n\r]/.test(command) ? '仅支持空格分隔 argv；不能含引号、变量、管道、重定向或命令分隔符。' : undefined }
function active(status: ArenaStatus): boolean { return ['preparing', 'running', 'validating', 'scoring'].includes(status) }
function message(reason: unknown): string { return reason instanceof Error ? reason.message : String(reason) }
function time(value: string): string { const date = new Date(value); return Number.isNaN(date.getTime()) ? value : date.toLocaleString('zh-CN', { hour12: false }) }
function duration(value: number): string { return value >= 1000 ? `${(value / 1000).toFixed(value >= 10_000 ? 0 : 1)} 秒` : `${value} 毫秒` }

function ContestantResultView({ item, maxScore }: { item: ContestantResult; maxScore: number }): React.ReactElement {
  const validationNodes = item.validations.map((result, index) => React.createElement('details', { key: `${result.command}-${index}` },
    React.createElement('summary', null, React.createElement('span', { className: result.exitCode === 0 ? styles.pass : styles.fail }, result.exitCode === 0 ? '通过' : `退出 ${result.exitCode}`), ` ${result.command} · 权重 ${result.weight} · ${duration(result.durationMs)}`),
    React.createElement('pre', { className: styles.output }, result.output || '（无输出）')))
  return React.createElement('article', { className: styles.result },
    React.createElement('div', { className: styles.resultHead }, React.createElement('div', null, React.createElement('strong', null, item.contestant.label), React.createElement('span', null, `${item.contestant.provider} / ${item.contestant.model}`)), React.createElement('span', { className: styles.score }, `${item.score.toFixed(1)} 分`)),
    React.createElement('div', { className: styles.scoreTrack, role: 'progressbar', 'aria-label': `${item.contestant.label} 得分`, 'aria-valuemin': 0, 'aria-valuemax': maxScore, 'aria-valuenow': item.score }, React.createElement('span', { style: { width: `${Math.min(100, item.score / maxScore * 100)}%` } }), React.createElement('span', { className: styles.srOnly }, `${item.score.toFixed(1)} 分`)),
    item.error && React.createElement('p', { className: styles.fieldError }, item.error),
    React.createElement('p', { className: styles.files }, React.createElement('strong', null, '改动文件：'), item.changedFiles.length ? item.changedFiles.join('、') : '暂无改动'),
    item.validations.length > 0 && React.createElement('div', { className: styles.validationResults }, ...validationNodes),
    item.diff && React.createElement('details', { className: styles.diffPanel }, React.createElement('summary', null, `查看 ${item.contestant.label} 的 diff`), React.createElement('pre', { className: styles.diff }, item.diff)))
}

function MatchDetail({ match, busy, confirming, onCancel, onConfirm, onDismiss, onApply }: { match: ArenaMatch; busy: string | undefined; confirming: boolean; onCancel(): void; onConfirm(): void; onDismiss(): void; onApply(): void }): React.ReactElement {
  const maxScore = Math.max(100, ...match.contestants.map(item => item.score))
  const canApply = match.status === 'completed' && Boolean(match.winnerId) && !match.appliedRevision
  return React.createElement('article', { className: styles.detail, 'aria-labelledby': 'match-detail-title' },
    React.createElement('div', { className: styles.detailHeading }, React.createElement('div', null, React.createElement('h3', { id: 'match-detail-title' }, `比赛 #${match.id.slice(0, 8)}`), React.createElement('p', null, `创建于 ${time(match.createdAt)}`)), React.createElement('span', { className: `${styles.statusChip} ${styles[`status${match.status}`]}` }, statusLabels[match.status])),
    match.error && React.createElement('p', { className: `${styles.notice} ${styles.error}`, role: 'alert' }, match.error),
    React.createElement('ol', { className: styles.timeline, 'aria-label': '比赛事件时间线' }, ...match.events.slice(-8).map((event, index) => React.createElement('li', { key: `${event.at}-${index}` }, React.createElement('time', { dateTime: event.at }, time(event.at)), React.createElement('span', null, event.message)))),
    React.createElement('section', { 'aria-labelledby': 'score-title' }, React.createElement('h4', { id: 'score-title' }, '得分与验证'), ...match.contestants.map(item => React.createElement(ContestantResultView, { key: item.contestant.id, item, maxScore }))),
    match.winnerId && React.createElement('p', { className: styles.winner }, React.createElement('strong', null, '当前胜者：'), match.contestants.find(item => item.contestant.id === match.winnerId)?.contestant.label ?? match.winnerId),
    match.appliedRevision && React.createElement('p', { className: `${styles.notice} ${styles.success}` }, '胜者补丁已应用；提交仍由你自行决定。'),
    active(match.status) && React.createElement('button', { type: 'button', className: styles.danger, disabled: Boolean(busy), onClick: onCancel }, busy === 'cancel' ? '正在取消…' : '取消比赛'),
    canApply && !confirming && React.createElement('button', { type: 'button', className: styles.primary, disabled: Boolean(busy), onClick: onConfirm }, '审阅后申请应用胜者'),
    canApply && confirming && React.createElement('div', { className: styles.confirmation, role: 'alertdialog', 'aria-label': '确认应用胜者改动' }, React.createElement('strong', null, '确认应用胜者补丁？'), React.createElement('p', null, '这会再次检查原仓库是否干净、HEAD 是否仍与比赛起点一致，并先执行 git apply --check。Arena 不会提交、推送或改写历史。'), React.createElement('div', null, React.createElement('button', { type: 'button', className: styles.secondary, disabled: Boolean(busy), onClick: onDismiss }, '返回审阅'), React.createElement('button', { type: 'button', className: styles.primary, disabled: Boolean(busy), onClick: onApply }, busy === 'apply' ? '正在复核并应用…' : '确认应用补丁'))))
}

function ArenaPanel({ api }: { api: Api }): React.ReactElement {
  const [matches, setMatches] = useState<ArenaMatch[]>([])
  const [selectedId, setSelectedId] = useState<string>()
  const [repository, setRepository] = useState('')
  const [objective, setObjective] = useState('')
  const [contestants, setContestants] = useState<Contestant[]>([makeContestant(0), makeContestant(1)])
  const [validation, setValidation] = useState<ValidationCommand[]>(initialValidation)
  const [error, setError] = useState<string>()
  const [notice, setNotice] = useState<Notice>()
  const [busy, setBusy] = useState<'start' | 'cancel' | 'apply'>()
  const [confirmApplyId, setConfirmApplyId] = useState<string>()
  const selected = useMemo(() => matches.find(match => match.id === selectedId) ?? matches[0], [matches, selectedId])
  const ready = Boolean(repository.trim() && objective.trim() && contestants.every(item => item.provider.trim() && item.model.trim()) && validation.every(item => !problem(item.command)))
  const refresh = (): void => { void api.list(20).then(items => { setMatches(items); setError(undefined) }).catch(reason => setError(message(reason))) }
  useEffect(() => { let mounted = true; const load = (): void => { void api.list(20).then(items => { if (mounted) { setMatches(items); setError(undefined) } }).catch(reason => { if (mounted) setError(message(reason)) }) }; load(); const timer = setInterval(load, 2000); return () => { mounted = false; clearInterval(timer) } }, [api])
  const run = (kind: 'start' | 'cancel' | 'apply', work: () => Promise<ArenaMatch>, success: string): void => { setBusy(kind); setError(undefined); setNotice(undefined); void work().then(match => { setSelectedId(match.id); setNotice({ tone: 'success', message: success }); return api.list(20) }).then(setMatches).catch(reason => setError(message(reason))).finally(() => setBusy(undefined)) }
  const editContestant = (index: number, key: 'label' | 'provider' | 'model', value: string): void => setContestants(items => items.map((item, itemIndex) => itemIndex === index ? { ...item, [key]: value } : item))
  const editValidation = (index: number, key: keyof ValidationCommand, value: string | number): void => setValidation(items => items.map((item, itemIndex) => itemIndex === index ? { ...item, [key]: value } : item))
  const start = (): void => { if (!ready) return; run('start', () => api.start({ repository: repository.trim(), objective: objective.trim(), contestants: contestants.map(item => ({ ...item, label: item.label.trim() || item.id, provider: item.provider.trim(), model: item.model.trim() })), validation: validation.map(item => ({ ...item, command: item.command.trim() })), keepWorktrees: false }), '比赛已创建，正在轮询进度。') }
  return React.createElement('section', { className: styles.arena, 'aria-labelledby': 'arena-title' },
    React.createElement('header', { className: styles.hero }, React.createElement('div', null, React.createElement('p', { className: styles.eyebrow }, 'DSH AGENT ARENA'), React.createElement('h2', { id: 'arena-title' }, '模型编码竞技场'), React.createElement('p', { className: styles.intro }, '让 2–4 名模型选手在隔离 worktree 中完成同一任务；使用确定性验证评分，并始终由你明确决定是否应用胜者改动。')), React.createElement('div', { className: styles.safety }, React.createElement('strong', null, '安全边界'), React.createElement('span', null, '无 Shell · 不自动应用 · 应用前复核漂移'))),
    error && React.createElement('p', { role: 'alert', className: `${styles.notice} ${styles.error}` }, React.createElement('strong', null, '操作未完成：'), ` ${error}`),
    notice && React.createElement('p', { role: 'status', className: `${styles.notice} ${notice.tone === 'success' ? styles.success : styles.info}` }, notice.message),
    React.createElement('div', { className: styles.grid },
      React.createElement('form', { className: styles.card, onSubmit: (event: React.FormEvent<HTMLFormElement>) => { event.preventDefault(); start() } },
        React.createElement('div', { className: styles.cardHeading }, React.createElement('div', null, React.createElement('p', { className: styles.step }, '第 1 步'), React.createElement('h3', null, '配置一场比赛')), React.createElement('span', { className: styles.counter }, `${contestants.length} / ${MAX_CONTESTANTS} 位选手`)),
        React.createElement('ol', { className: styles.guide }, React.createElement('li', null, '填写一个工作区干净的 Git 仓库路径。'), React.createElement('li', null, '为每位选手指定可用的 provider 与 model。'), React.createElement('li', null, '添加可重复执行、无需 Shell 的验证 argv。')),
        React.createElement('label', { htmlFor: 'arena-repository' }, 'Git 仓库路径', React.createElement('span', { className: styles.required, 'aria-hidden': 'true' }, ' *'), React.createElement('input', { id: 'arena-repository', required: true, autoComplete: 'off', placeholder: '例如 C:\\workspace\\my-project', value: repository, onChange: event => setRepository(event.currentTarget.value), 'aria-describedby': 'arena-repository-help' })), React.createElement('p', { id: 'arena-repository-help', className: styles.help }, '开始前会检查 git status 是否干净；不会在原仓库直接执行选手改动。'),
        React.createElement('label', { htmlFor: 'arena-objective' }, '任务目标', React.createElement('span', { className: styles.required, 'aria-hidden': 'true' }, ' *'), React.createElement('textarea', { id: 'arena-objective', required: true, placeholder: '描述要实现的功能、范围与验收条件', value: objective, onChange: (event: React.ChangeEvent<HTMLTextAreaElement>) => setObjective(event.currentTarget.value) })),
        React.createElement('div', { className: styles.sectionHeading }, React.createElement('div', null, React.createElement('h4', null, '选手'), React.createElement('p', null, '至少 2 位，最多 4 位。每位选手使用独立会话和 worktree。')), React.createElement('button', { type: 'button', className: styles.secondary, disabled: contestants.length >= MAX_CONTESTANTS || Boolean(busy), onClick: () => setContestants(items => items.length < MAX_CONTESTANTS ? [...items, makeContestant(items.length)] : items) }, '添加选手')),
        ...contestants.map((item, index) => React.createElement('fieldset', { key: item.id, className: styles.contestant }, React.createElement('legend', null, `选手 ${index + 1}`), React.createElement('div', { className: styles.fieldGrid }, React.createElement('label', { htmlFor: `contestant-label-${index}` }, '显示名称', React.createElement('input', { id: `contestant-label-${index}`, value: item.label, maxLength: 80, onChange: event => editContestant(index, 'label', event.currentTarget.value) })), React.createElement('label', { htmlFor: `contestant-provider-${index}` }, 'Provider *', React.createElement('input', { id: `contestant-provider-${index}`, required: true, value: item.provider, placeholder: '例如 deepseek', onChange: event => editContestant(index, 'provider', event.currentTarget.value) })), React.createElement('label', { htmlFor: `contestant-model-${index}` }, 'Model *', React.createElement('input', { id: `contestant-model-${index}`, required: true, value: item.model, placeholder: '例如 deepseek-chat', onChange: event => editContestant(index, 'model', event.currentTarget.value) }))), React.createElement('button', { type: 'button', className: styles.textButton, disabled: contestants.length <= MIN_CONTESTANTS || Boolean(busy), onClick: () => setContestants(items => items.length > MIN_CONTESTANTS ? items.filter((_, itemIndex) => itemIndex !== index) : items), 'aria-label': `移除${item.label || `选手 ${index + 1}`}` }, '移除选手'))),
        React.createElement('div', { className: styles.sectionHeading }, React.createElement('div', null, React.createElement('h4', null, '验证命令与权重'), React.createElement('p', null, '总分按成功命令的权重比例计算；每行独立执行。')), React.createElement('button', { type: 'button', className: styles.secondary, disabled: validation.length >= MAX_VALIDATIONS || Boolean(busy), onClick: () => setValidation(items => items.length < MAX_VALIDATIONS ? [...items, { command: '', weight: 1, timeoutMs: DEFAULT_TIMEOUT }] : items) }, '添加验证')),
        React.createElement('p', { className: styles.preflight }, React.createElement('strong', null, '预检提示：'), '仅接受空格分隔 argv，如 corepack pnpm test。引号、变量、管道、重定向、分号和换行会被拒绝；不会调用 Shell。'),
        ...validation.map((item, index) => { const issue = problem(item.command); return React.createElement('div', { key: `validation-${index}`, className: styles.validationRow }, React.createElement('label', { htmlFor: `validation-command-${index}` }, `验证命令 ${index + 1}`, React.createElement('input', { id: `validation-command-${index}`, required: true, value: item.command, placeholder: 'corepack pnpm test', onChange: event => editValidation(index, 'command', event.currentTarget.value), 'aria-invalid': Boolean(issue), 'aria-describedby': issue ? `validation-error-${index}` : undefined })), React.createElement('label', { htmlFor: `validation-weight-${index}` }, '权重', React.createElement('input', { id: `validation-weight-${index}`, type: 'number', min: 0.1, max: 100, step: 0.1, required: true, value: item.weight, onChange: event => editValidation(index, 'weight', Math.max(0.1, Number(event.currentTarget.value) || 0.1)) })), React.createElement('label', { htmlFor: `validation-timeout-${index}` }, '超时（秒）', React.createElement('input', { id: `validation-timeout-${index}`, type: 'number', min: 1, max: 900, required: true, value: Math.round(item.timeoutMs / 1000), onChange: event => editValidation(index, 'timeoutMs', Math.min(900_000, Math.max(1_000, (Number(event.currentTarget.value) || 1) * 1000))) })), React.createElement('button', { type: 'button', className: styles.textButton, disabled: validation.length <= 1 || Boolean(busy), onClick: () => setValidation(items => items.length > 1 ? items.filter((_, itemIndex) => itemIndex !== index) : items), 'aria-label': `移除验证命令 ${index + 1}` }, '移除'), issue && React.createElement('p', { id: `validation-error-${index}`, className: styles.fieldError }, issue)) }),
        React.createElement('div', { className: styles.formFooter }, React.createElement('p', null, '创建后可随时取消；取消不会影响原仓库。'), React.createElement('button', { type: 'submit', className: styles.primary, disabled: Boolean(busy) || !ready }, busy === 'start' ? '正在创建比赛…' : '开始隔离比赛'))),
      React.createElement('div', { className: styles.card, 'aria-live': 'polite' }, React.createElement('div', { className: styles.cardHeading }, React.createElement('div', null, React.createElement('p', { className: styles.step }, '第 2 步'), React.createElement('h3', null, '比赛与结果')), React.createElement('button', { type: 'button', className: styles.secondary, disabled: Boolean(busy), onClick: refresh }, '刷新状态')), matches.length === 0 ? React.createElement('div', { className: styles.empty }, React.createElement('strong', null, '还没有比赛'), React.createElement('p', null, '完成左侧配置后启动第一场比赛。')) : React.createElement('div', { className: styles.matchList, role: 'list', 'aria-label': '最近比赛' }, ...matches.map(match => React.createElement('button', { key: match.id, type: 'button', className: `${styles.matchButton} ${selected?.id === match.id ? styles.selected : ''}`, onClick: () => setSelectedId(match.id), 'aria-pressed': selected?.id === match.id }, React.createElement('span', null, `#${match.id.slice(0, 8)}`), React.createElement('span', { className: `${styles.statusChip} ${styles[`status${match.status}`]}` }, statusLabels[match.status]), React.createElement('small', null, time(match.updatedAt))))), selected && React.createElement(MatchDetail, { match: selected, busy, confirming: confirmApplyId === selected.id, onCancel: () => run('cancel', () => api.cancel(selected.id), '已请求取消比赛。'), onConfirm: () => setConfirmApplyId(selected.id), onDismiss: () => setConfirmApplyId(undefined), onApply: () => { setConfirmApplyId(undefined); run('apply', () => api.applyWinner(selected.id), '获胜者补丁已通过漂移检查并应用到索引。') } }))))
}

export async function apply(ctx: ClientContext): Promise<() => Promise<void>> {
  const disposeRemote = await ctx.remote.$mount(arenaRemote)
  const api = apiFrom((ctx.remote as unknown as { agentArena: RawApi }).agentArena)
  ctx.slots.inject('settings.section', () => ctx.slots.register({ name: 'settings.section', id: 'agent-arena', order: 80, label: () => '竞技场', inject: () => ({ api }) }, ArenaPanel))
  return disposeRemote
}
