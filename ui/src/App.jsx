import { useCallback, useEffect, useMemo, useState } from 'react';
import { PROJECTS } from './projects.js';
import { addNote, createClient, loadProject, releaseReadiness } from './lib/data.js';

const TOKEN_KEY = 'test-hub-token';

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
  const [state, setState] = useState({});
  const [loadedAt, setLoadedAt] = useState(null);

  const refresh = useCallback(async () => {
    const client = createClient({ token: token || undefined });
    setState(Object.fromEntries(PROJECTS.map((project) => [project.key, { loading: true }])));
    await Promise.all(
      PROJECTS.map(async (project) => {
        try {
          const data = await loadProject(client, project);
          setState((current) => ({ ...current, [project.key]: { data } }));
        } catch (error) {
          setState((current) => ({ ...current, [project.key]: { error: error.message } }));
        }
      }),
    );
    setLoadedAt(new Date().toISOString());
  }, [token]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const saveToken = (value) => {
    if (value) localStorage.setItem(TOKEN_KEY, value);
    else localStorage.removeItem(TOKEN_KEY);
    setToken(value);
    window.location.hash = '#/';
  };

  const [page, key] = route.split('/');
  let body;
  if (page === 'ayarlar') body = <Settings token={token} onSave={saveToken} />;
  else if (page === 'release') body = <Release state={state} />;
  else if (page === 'p' && PROJECTS.some((project) => project.key === key)) {
    body = <ProjectDetail project={PROJECTS.find((project) => project.key === key)} entry={state[key]} token={token} />;
  } else body = <Overview state={state} hasToken={Boolean(token)} />;

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

function Overview({ state, hasToken }) {
  const needsToken = PROJECTS.some((project) => state[project.key]?.data?.needsToken);
  return (
    <>
      {needsToken && !hasToken && (
        <p className="notice">
          Private projeleri görmek için <a href="#/ayarlar">Ayarlar</a> bölümünden bir GitHub token'ı ekle.
        </p>
      )}
      <div className="grid">
        {PROJECTS.map((project) => (
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

function Release({ state }) {
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
        {PROJECTS.map((project) => {
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

function ProjectDetail({ project, entry, token }) {
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

function Settings({ token, onSave }) {
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
      <p>
        Panelden kalan testlere not düşmek istersen (not, Issue'ya yorum olarak eklenir) <strong>Issues</strong> iznini{' '}
        <em>Read and write</em> yap. Gerekmiyorsa salt okunur bırak.
      </p>
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
    </section>
  );
}
