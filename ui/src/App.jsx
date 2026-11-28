import { useCallback, useEffect, useMemo, useState } from 'react';
import { PROJECTS } from './projects.js';
import {
  addNote,
  createClient,
  listRepos,
  loadProject,
  projectFromRepo,
  releaseReadiness,
  startAnalysis,
} from './lib/data.js';

const TOKEN_KEY = 'test-hub-token';
const EXTRAS_KEY = 'test-hub-projects';

// Projects added from Settings, kept in this browser only.
function readExtras() {
  try {
    const list = JSON.parse(localStorage.getItem(EXTRAS_KEY) ?? '[]');
    return Array.isArray(list) ? list.filter((item) => item?.key && item?.repo && item?.catalog) : [];
  } catch {
    return [];
  }
}

const STATUS = {
  passed: { label: 'geçti', tone: 'ok' },
  failed: { label: 'kaldı', tone: 'bad' },
  flaky: { label: 'kararsız', tone: 'warn' },
  skipped: { label: 'atlandı', tone: 'muted' },
  running: { label: 'koşuyor', tone: 'info' },
  'not-written': { label: 'yazılmadı', tone: 'muted' },
};
const STATUS_ORDER = ['failed', 'flaky', 'passed', 'not-written', 'skipped', 'running'];
const HEALTH = {
  passing: { label: 'Sağlam', tone: 'ok' },
  warning: { label: 'Açık sorun var', tone: 'warn' },
  failing: { label: 'Kırık', tone: 'bad' },
  unknown: { label: 'Koşu yok', tone: 'muted' },
};
const VERDICT = {
  ready: { label: 'Hazır', tone: 'ok' },
  warnings: { label: 'Uyarılarla hazır', tone: 'warn' },
  blocked: { label: 'Hazır değil', tone: 'bad' },
};
const PRIORITY = { critical: 'kritik', high: 'yüksek', medium: 'orta', normal: 'normal', low: 'düşük' };
const statusInfo = (status) => STATUS[status] ?? { label: status || '—', tone: 'muted' };

const relative = new Intl.RelativeTimeFormat('tr', { numeric: 'auto' });
function ago(iso) {
  if (!iso) return '—';
  const seconds = (new Date(iso).getTime() - Date.now()) / 1000;
  const steps = [
    [60, 'second'],
    [60, 'minute'],
    [24, 'hour'],
    [30, 'day'],
    [12, 'month'],
  ];
  let value = seconds;
  for (const [size, unit] of steps) {
    if (Math.abs(value) < size) return relative.format(Math.round(value), unit);
    value /= size;
  }
  return relative.format(Math.round(value), 'year');
}

function useRoute() {
  const read = () => window.location.hash.replace(/^#\/?/, '');
  const [route, setRoute] = useState(read);
  useEffect(() => {
    const update = () => setRoute(read());
    window.addEventListener('hashchange', update);
    return () => window.removeEventListener('hashchange', update);
  }, []);
  return route;
}

export default function App() {
  const route = useRoute();
  const [token, setToken] = useState(() => localStorage.getItem(TOKEN_KEY) ?? '');
  const [extras, setExtras] = useState(readExtras);
  const [state, setState] = useState({});
  const [loadedAt, setLoadedAt] = useState(null);
  const projects = useMemo(() => [...PROJECTS, ...extras], [extras]);

  const refresh = useCallback(async () => {
    const client = createClient({ token: token || undefined });
    setState(Object.fromEntries(projects.map((project) => [project.key, { loading: true }])));
    await Promise.all(
      projects.map(async (project) => {
        try {
          const data = await loadProject(client, project);
          setState((current) => ({ ...current, [project.key]: { data } }));
        } catch (error) {
          setState((current) => ({ ...current, [project.key]: { error: error.message } }));
        }
      }),
    );
    setLoadedAt(new Date().toISOString());
  }, [token, projects]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const saveToken = (value) => {
    if (value) localStorage.setItem(TOKEN_KEY, value);
    else localStorage.removeItem(TOKEN_KEY);
    setToken(value);
    window.location.hash = '#/';
  };
  const saveExtras = (next) => {
    localStorage.setItem(EXTRAS_KEY, JSON.stringify(next));
    setExtras(next);
  };

  const [page, key] = route.split('/');
  const selected = projects.find((project) => project.key === key);
  let body;
  if (page === 'ayarlar') {
    body = <Settings token={token} onSave={saveToken} projects={projects} extras={extras} onExtras={saveExtras} />;
  } else if (page === 'release') body = <Release state={state} projects={projects} />;
  else if (page === 'p' && selected) {
    body = <ProjectDetail project={selected} entry={state[key]} token={token} onRefresh={refresh} />;
  } else body = <Overview state={state} hasToken={Boolean(token)} projects={projects} />;

  return (
    <div className="app">
      <header className="topbar">
        <a className="brand" href="#/">
          <img src="./icon.svg" alt="" width="24" height="24" />
          test-hub
        </a>
        <div className="topbar-actions">
          <span className="muted small">{loadedAt ? `Güncellendi ${ago(loadedAt)}` : 'Yükleniyor…'}</span>
          <button type="button" onClick={refresh}>
            Yenile
          </button>
          <a className="button" href="#/release">
            Release
          </a>
          <a className="button" href="#/ayarlar">
            Ayarlar
          </a>
        </div>
      </header>
      <main>{body}</main>
    </div>
  );
}

function Badge({ tone, children }) {
  return <span className={`badge tone-${tone}`}>{children}</span>;
}

function StatusBar({ counts, total }) {
  if (!total) return <div className="bar empty" />;
  return (
    <div className="bar" role="img" aria-label={STATUS_ORDER.filter((s) => counts[s]).map((s) => `${counts[s]} ${statusInfo(s).label}`).join(', ')}>
      {STATUS_ORDER.filter((status) => counts[status]).map((status) => (
        <span key={status} className={`tone-${statusInfo(status).tone}`} style={{ flexGrow: counts[status] }} />
      ))}
    </div>
  );
}

function Overview({ state, hasToken, projects }) {
  const needsToken = projects.some((project) => state[project.key]?.data?.needsToken);
  return (
    <>
      {needsToken && !hasToken && (
        <p className="notice">
          Private projeleri görmek için <a href="#/ayarlar">Ayarlar</a> bölümünden bir GitHub token'ı ekle.
        </p>
      )}
      <div className="grid">
        {projects.map((project) => (
          <ProjectCard key={project.key} project={project} entry={state[project.key]} />
        ))}
      </div>
    </>
  );
}

function ProjectCard({ project, entry }) {
  const data = entry?.data;
  let content;
  if (!entry || entry.loading) content = <p className="muted">Yükleniyor…</p>;
  else if (entry.error) content = <p className="error">{entry.error}</p>;
  else if (data.notConnected) content = <p className="muted">Henüz test-hub'a bağlı değil.</p>;
  else if (data.needsToken) content = <p className="muted">Private repo: token gerekli.</p>;
  else if (data.missing) content = <p className="error">Repo bulunamadı ya da token'ın erişimi yok.</p>;
  else {
    const total = data.rows.length;
    const health = HEALTH[data.health];
    content = (
      <>
        <div className="row-between">
          <Badge tone={health.tone}>{health.label}</Badge>
          <span className="muted small">
            {data.lastRun ? `Son koşu ${ago(data.lastRun.created_at)}` : 'Koşu yok'}
          </span>
        </div>
        <StatusBar counts={data.counts} total={total} />
        <ul className="facts">
          <li>
            <strong>{total}</strong> kart
          </li>
          {STATUS_ORDER.filter((status) => data.counts[status]).map((status) => (
            <li key={status}>
              <strong>{data.counts[status]}</strong> {statusInfo(status).label}
            </li>
          ))}
          {data.deviceCards > 0 && (
            <li>
              <strong>{data.deviceCards}</strong> cihazda
            </li>
          )}
          <li>
            <strong>{data.openIssues}</strong> açık sorun
          </li>
        </ul>
      </>
    );
  }
  const linkable = data && !data.notConnected && !data.needsToken && !data.missing && !entry.error;
  const inner = (
    <>
      <div className="row-between">
        <h2>{project.name}</h2>
        <span className="muted small">{project.line}</span>
      </div>
      {content}
    </>
  );
  return linkable ? (
    <a className="card link" href={`#/p/${project.key}`}>
      {inner}
    </a>
  ) : (
    <div className="card">{inner}</div>
  );
}

function ReadinessList({ readiness }) {
  return (
    <ul className="checks">
      {readiness.blockers.map((text) => (
        <li key={text} className="tone-bad">
          <span aria-hidden="true">✗</span> {text}
        </li>
      ))}
      {readiness.warnings.map((text) => (
        <li key={text} className="tone-warn">
          <span aria-hidden="true">!</span> {text}
        </li>
      ))}
      {readiness.passes.map((text) => (
        <li key={text} className="tone-ok">
          <span aria-hidden="true">✓</span> {text}
        </li>
      ))}
    </ul>
  );
}

function Release({ state, projects }) {
  return (
    <>
      <a className="back" href="#/">
        ← Projeler
      </a>
      <h1>Release hazırlığı</h1>
      <p className="muted small">
        Kalan kritik test ya da başarısız son koşu release'i durdurur. Diğer kırıklar, kararsız testler ve eski cihaz
        koşuları uyarıdır.
      </p>
      <div className="stack">
        {projects.map((project) => {
          const entry = state[project.key];
          const data = entry?.data;
          if (!entry || entry.loading || entry.error || !data?.rows) {
            const note = !entry || entry.loading
              ? 'Yükleniyor…'
              : entry.error
                ? entry.error
                : data.notConnected
                  ? "Henüz test-hub'a bağlı değil."
                  : 'Token gerekli.';
            return (
              <div key={project.key} className="card">
                <h2>{project.name}</h2>
                <p className={entry?.error ? 'error' : 'muted'}>{note}</p>
              </div>
            );
          }
          const readiness = releaseReadiness(data);
          return (
            <div key={project.key} className="card">
              <div className="row-between">
                <a href={`#/p/${project.key}`}>
                  <h2>{project.name}</h2>
                </a>
                <Badge tone={VERDICT[readiness.verdict].tone}>{VERDICT[readiness.verdict].label}</Badge>
              </div>
              <ReadinessList readiness={readiness} />
            </div>
          );
        })}
      </div>
    </>
  );
}

function NoteForm({ repo, issue, token }) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');
  const [status, setStatus] = useState({});
  if (!open) {
    return (
      <button type="button" className="link-button" onClick={() => setOpen(true)}>
        {status.sent ? 'Not eklendi · yeni not' : 'Not ekle'}
      </button>
    );
  }
  const submit = async (event) => {
    event.preventDefault();
    setStatus({ busy: true });
    try {
      await addNote(createClient({ token }), repo, issue.number, text);
      setText('');
      setOpen(false);
      setStatus({ sent: true });
    } catch (error) {
      setStatus({ error: error.message });
    }
  };
  return (
    <form className="note" onSubmit={submit}>
      <textarea
        aria-label={`Sorun #${issue.number} için not`}
        rows={3}
        value={text}
        onChange={(event) => setText(event.target.value)}
        placeholder="Issue'ya yorum olarak eklenir"
      />
      {status.error && <p className="error small">{status.error}</p>}
      <div className="row">
        <button type="submit" disabled={status.busy || !text.trim()}>
          {status.busy ? 'Gönderiliyor…' : 'Gönder'}
        </button>
        <button type="button" className="link-button" onClick={() => setOpen(false)}>
          Vazgeç
        </button>
      </div>
    </form>
  );
}

const DOC_LABELS = {
  'TEST-REPORT.md': 'Test raporu',
  'functions.md': 'Fonksiyonlar ve beklenen durumlar',
  'SRS.md': 'SRS (gereksinimler)',
  'SDD.md': 'SDD (tasarım)',
  'README.md': 'Devir paketi',
};

function AnalysisSection({ project, data, token, onRefresh }) {
  const [focus, setFocus] = useState('');
  const [maxCards, setMaxCards] = useState(25);
  const [status, setStatus] = useState({});
  const { analysis } = data;
  if (!analysis) return null;
  const run = analysis.lastRun;
  const runTone = !run ? 'muted' : run.status !== 'completed' ? 'info' : run.conclusion === 'success' ? 'ok' : 'bad';
  const runLabel = !run ? 'Henüz koşmadı' : run.status !== 'completed' ? 'Sürüyor' : run.conclusion === 'success' ? 'Tamamlandı' : 'Başarısız';

  const start = async (event) => {
    event.preventDefault();
    setStatus({ busy: true });
    try {
      await startAnalysis(createClient({ token }), data.project, { focus, maxCards });
      setStatus({ started: true });
      setTimeout(onRefresh, 5000);
    } catch (error) {
      setStatus({ error: error.message });
    }
  };

  return (
    <section>
      <div className="row-between">
        <h3>Analiz ve belgeler</h3>
        {analysis.enabled && <Badge tone={runTone}>{runLabel}</Badge>}
      </div>
      {analysis.docs.length ? (
        <ul className="doc-links">
          {analysis.docs.map((doc) => (
            <li key={doc.name}>
              <a href={doc.url} target="_blank" rel="noreferrer">
                {DOC_LABELS[doc.name] ?? doc.name}
              </a>
            </li>
          ))}
        </ul>
      ) : (
        <p className="muted small">Ana dalda henüz analiz belgesi yok (docs/analysis).</p>
      )}
      {run && (
        <p className="muted small">
          Son analiz: <a href={run.html_url} target="_blank" rel="noreferrer">{ago(run.created_at)}</a>. Sonuç pull request olarak gelir.
        </p>
      )}
      {!analysis.enabled ? (
        <p className="small">
          Bu projede <code>test-hub-analyze.yml</code> yok.{' '}
          <a href="https://github.com/ferhanburak/test-hub#analizi-github-actionsta-çalıştırma" target="_blank" rel="noreferrer">
            Kurulum adımları
          </a>
        </p>
      ) : !token ? (
        <p className="muted small">Analizi başlatmak için Ayarlar'dan token ekle.</p>
      ) : (
        <form className="analyze-form" onSubmit={start}>
          <label htmlFor="focus">Önce bakılacak alan (isteğe bağlı)</label>
          <input id="focus" value={focus} maxLength={160} onChange={(event) => setFocus(event.target.value)} placeholder="ör. giriş ve ödeme" />
          <label htmlFor="max-cards">En fazla yeni kart</label>
          <input id="max-cards" type="number" min="1" max="50" value={maxCards} onChange={(event) => setMaxCards(event.target.value)} />
          {status.error && <p className="error small">{status.error}</p>}
          {status.started && (
            <p className="small">
              Başlatıldı. Claude testleri ve belgeleri hazırlayınca{' '}
              <a href={`${data.project.url}/pulls`} target="_blank" rel="noreferrer">
                pull request
              </a>{' '}
              açılacak.
            </p>
          )}
          <div className="row">
            <button type="submit" disabled={status.busy || run?.status === 'in_progress' || run?.status === 'queued'}>
              {status.busy ? 'Başlatılıyor…' : 'Analiz ve test üret'}
            </button>
          </div>
        </form>
      )}
    </section>
  );
}

function ProjectDetail({ project, entry, token, onRefresh }) {
  const [filter, setFilter] = useState('all');
  const data = entry?.data;
  const rows = useMemo(() => {
    if (!data?.rows) return [];
    if (filter === 'all') return data.rows;
    if (filter === 'device') return data.rows.filter((row) => row.device);
    return data.rows.filter((row) => row.status === filter);
  }, [data, filter]);

  if (!entry || entry.loading) return <p className="muted">Yükleniyor…</p>;
  if (entry.error) return <p className="error">{entry.error}</p>;
  if (!data.rows) return <p className="muted">Bu proje için veri yok.</p>;

  const health = HEALTH[data.health];
  const readiness = releaseReadiness(data);
  const filters = [
    ['all', `Tümü (${data.rows.length})`],
    ...STATUS_ORDER.filter((status) => data.counts[status]).map((status) => [status, `${statusInfo(status).label} (${data.counts[status]})`]),
    ...(data.deviceCards ? [['device', `cihazda (${data.deviceCards})`]] : []),
  ];

  return (
    <>
      <a className="back" href="#/">
        ← Projeler
      </a>
      <div className="row-between wrap">
        <h1>{project.name}</h1>
        <Badge tone={health.tone}>{health.label}</Badge>
      </div>
      <p className="links">
        <a href={data.project.url} target="_blank" rel="noreferrer">
          Repo
        </a>
        <a href={`${data.project.url}/actions/workflows/test-hub.yml`} target="_blank" rel="noreferrer">
          Koşular
        </a>
        <a href={`${data.project.url}/issues?q=is%3Aopen+label%3Atest-hub`} target="_blank" rel="noreferrer">
          Açık sorunlar ({data.openIssues})
        </a>
      </p>

      <AnalysisSection project={project} data={data} token={token} onRefresh={onRefresh} />

      <section>
        <div className="row-between">
          <h3>Release hazırlığı</h3>
          <Badge tone={VERDICT[readiness.verdict].tone}>{VERDICT[readiness.verdict].label}</Badge>
        </div>
        <ReadinessList readiness={readiness} />
      </section>

      <section>
        <h3>Son koşular</h3>
        {data.recentRuns.length ? (
          <ol className="runs">
            {data.recentRuns.map((run) => {
              const tone = run.conclusion === 'success' ? 'ok' : run.conclusion === 'failure' ? 'bad' : run.status !== 'completed' ? 'info' : 'muted';
              return (
                <li key={run.id}>
                  <a
                    className={`run tone-${tone}`}
                    href={run.html_url}
                    target="_blank"
                    rel="noreferrer"
                    title={`${run.conclusion ?? run.status} · ${run.event} · ${new Date(run.created_at).toLocaleString('tr-TR')}`}
                  />
                </li>
              );
            })}
          </ol>
        ) : (
          <p className="muted">Ana dalda koşu yok.</p>
        )}
        {data.lastRun && (
          <p className="muted small">
            Son: {data.lastRun.conclusion ?? data.lastRun.status} · {data.lastRun.event} · {ago(data.lastRun.created_at)}
          </p>
        )}
      </section>

      <section>
        <div className="chips" role="tablist">
          {filters.map(([value, label]) => (
            <button key={value} type="button" className={filter === value ? 'chip active' : 'chip'} onClick={() => setFilter(value)}>
              {label}
            </button>
          ))}
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>ID</th>
                <th>Test</th>
                <th>Öncelik</th>
                <th>Durum</th>
                <th>Not</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id}>
                  <td className="mono">{row.id}</td>
                  <td>{row.title}</td>
                  <td className={row.priority === 'critical' ? 'strong' : ''}>{PRIORITY[row.priority] ?? row.priority ?? '—'}</td>
                  <td>
                    <Badge tone={statusInfo(row.status).tone}>{statusInfo(row.status).label}</Badge>
                  </td>
                  <td className="small">
                    {row.issue && (
                      <>
                        <a href={row.issue.html_url} target="_blank" rel="noreferrer">
                          Sorun #{row.issue.number}
                        </a>
                        {token && <NoteForm repo={project.repo} issue={row.issue} token={token} />}
                      </>
                    )}
                    {row.device && <span className="muted">cihazda · {row.last_run || 'hiç koşmadı'}</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {data.orphanIssues.length > 0 && (
          <p className="muted small">Kartı olmayan açık sorun: {data.orphanIssues.map((issue) => `#${issue.number}`).join(', ')}</p>
        )}
      </section>
    </>
  );
}

function ProjectSettings({ token, projects, extras, onExtras }) {
  const [repos, setRepos] = useState(null);
  const [choice, setChoice] = useState('');
  const [error, setError] = useState('');
  const known = new Set(projects.map((project) => project.repo.toLowerCase()));

  const load = async () => {
    setError('');
    try {
      const list = await listRepos(createClient({ token }));
      setRepos(list.filter((repo) => !known.has(repo.fullName.toLowerCase())));
    } catch (err) {
      setError(err.message);
    }
  };
  const add = () => {
    if (!choice) return;
    onExtras([...extras, projectFromRepo(choice, projects.map((project) => project.key))]);
    setChoice('');
    setRepos((current) => current?.filter((repo) => repo.fullName !== choice) ?? null);
  };

  return (
    <>
      <h3>Projeler</h3>
      <p>
        Panel, sabit altı projeye ek olarak seçtiğin repoları da gösterir. Eklenen repoda kartlar{' '}
        <code>tests/catalog/</code> klasöründen okunur. Testleri ve belgeleri Claude'a hazırlatmak için repoya{' '}
        <code>test-hub-analyze.yml</code> eklenmelidir.
      </p>
      {extras.length > 0 && (
        <ul className="doc-links">
          {extras.map((project) => (
            <li key={project.key} className="row-between">
              <span>{project.repo}</span>
              <button type="button" className="link-button" onClick={() => onExtras(extras.filter((item) => item.key !== project.key))}>
                Kaldır
              </button>
            </li>
          ))}
        </ul>
      )}
      {!token ? (
        <p className="muted small">Repo eklemek için önce token'ı kaydet.</p>
      ) : repos === null ? (
        <button type="button" onClick={load}>
          Repolarımı listele
        </button>
      ) : (
        <div className="row">
          <select aria-label="Repo" value={choice} onChange={(event) => setChoice(event.target.value)}>
            <option value="">Repo seç…</option>
            {repos.map((repo) => (
              <option key={repo.fullName} value={repo.fullName}>
                {repo.fullName}
                {repo.private ? ' (private)' : ''}
              </option>
            ))}
          </select>
          <button type="button" onClick={add} disabled={!choice}>
            Ekle
          </button>
        </div>
      )}
      {error && <p className="error small">{error}</p>}
    </>
  );
}

function Settings({ token, onSave, projects, extras, onExtras }) {
  const [value, setValue] = useState(token);
  return (
    <section className="settings">
      <a className="back" href="#/">
        ← Projeler
      </a>
      <h1>Ayarlar</h1>
      <h3>GitHub token'ı</h3>
      <p>
        Public projeler token olmadan görünür. Private projeler (SoundApp, TrackSnap, BALSA Dekor) için salt okunur bir
        fine-grained token gerekir.
      </p>
      <ol>
        <li>GitHub → Settings → Developer settings → Fine-grained tokens → Generate new token.</li>
        <li>Repository access: test-hub'a bağlı proje repoları.</li>
        <li>
          Permissions: <strong>Actions</strong>, <strong>Contents</strong>, <strong>Issues</strong> ve{' '}
          <strong>Metadata</strong> için yalnızca <em>Read-only</em>.
        </li>
      </ol>
      <p>İsteğe bağlı yazma izinleri:</p>
      <ul>
        <li>
          Kalan testlere not düşmek için (not, Issue'ya yorum olarak eklenir) <strong>Issues</strong>: <em>Read and write</em>.
        </li>
        <li>
          Panelden "Analiz ve test üret" ile Claude'u başlatmak için <strong>Actions</strong>: <em>Read and write</em>.
        </li>
      </ul>
      <p className="muted small">Token yalnızca bu tarayıcıda saklanır ve sadece api.github.com'a gönderilir.</p>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          onSave(value.trim());
        }}
      >
        <label htmlFor="token">Token</label>
        <input
          id="token"
          type="password"
          autoComplete="off"
          spellCheck="false"
          value={value}
          onChange={(event) => setValue(event.target.value)}
          placeholder="github_pat_…"
        />
        <div className="row">
          <button type="submit">Kaydet</button>
          {token && (
            <button type="button" className="secondary" onClick={() => onSave('')}>
              Token'ı sil
            </button>
          )}
        </div>
      </form>
      <ProjectSettings token={token} projects={projects} extras={extras} onExtras={onExtras} />
    </section>
  );
}
