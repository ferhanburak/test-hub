// Projects shown in the panel. `catalog` is where the cards live: the
// project's own tests/catalog, or test-hub's catalog/<project>.
export const PROJECTS = [
  {
    key: 'celtikci',
    name: 'Çeltikci hukuk sitesi',
    repo: 'ferhanburak/celtikci-law-firm',
    line: 'web',
    catalog: { repo: 'ferhanburak/test-hub', path: 'catalog/celtikci' },
  },
  {
    key: 'soundapp',
    name: 'SoundApp',
    repo: 'ferhanburak/sound-app-v1',
    line: 'web',
    catalog: { repo: 'ferhanburak/sound-app-v1', path: 'tests/catalog' },
  },
  {
    key: 'tracksnap',
    name: 'TrackSnap',
    repo: 'ferhanburak/carfollow',
    line: 'mobil',
    catalog: { repo: 'ferhanburak/carfollow', path: 'tests/catalog' },
  },
  {
    key: 'mulakat-kocu',
    name: 'Mülakat koçu',
    repo: 'ferhanburak/mulakat-kocu',
    line: 'mobil',
    catalog: { repo: 'ferhanburak/mulakat-kocu', path: 'tests/catalog' },
  },
  {
    key: 'optik-sinav-kocu',
    name: 'Optik sınav koçu',
    repo: 'ferhanburak/optik-sinav-kocu',
    line: 'mobil',
    catalog: { repo: 'ferhanburak/optik-sinav-kocu', path: 'tests/catalog' },
  },
  {
    key: 'balsadekor',
    name: 'BALSA Dekor',
    repo: 'ferhanburak/balsadekor',
    line: 'web',
    connected: false,
  },
];

export const WORKFLOW_FILE = 'test-hub.yml';
