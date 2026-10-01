import { navigate, type SolitaireLaunch } from '../../app/App';
import { CAMPAIGN, loadCampaign, loadStats } from '../../storage/profile';
import { t } from '../../i18n';

export function HomeScreen({ onLaunchSolitaire }: { onLaunchSolitaire: (l: SolitaireLaunch | null) => void }) {
  const stats = loadStats();
  const campaign = loadCampaign();
  const stars = Object.values(campaign).reduce((n, c) => n + (c?.stars ?? 0), 0);
  const nextLevel = CAMPAIGN.find((l) => !(campaign[l.id]?.stars > 0)) ?? CAMPAIGN[0];

  const cards = [
    {
      icon: '🀫',
      name: t('home.c1n'),
      desc: t('home.c1d'),
      action: () => onLaunchSolitaire(null),
      meta: t('home.c1m', { n: stats.solitaire.gamesWon }),
    },
    {
      icon: '🎴',
      name: t('home.c2n'),
      desc: t('home.c2d'),
      action: () => navigate('traditional'),
      meta: t('home.c2m', { a: stats.traditional.handsWon, b: stats.traditional.handsPlayed }),
    },
    {
      icon: '🤖',
      name: t('home.c3n'),
      desc: t('home.c3d'),
      action: () => navigate('traditional'),
      meta: t('home.c3m'),
    },
    {
      icon: '🌐',
      name: t('home.c4n'),
      desc: t('home.c4d'),
      action: () => navigate('online'),
      meta: t('home.c4m'),
    },
    {
      icon: '🎓',
      name: t('home.c5n'),
      desc: t('home.c5d'),
      action: () => navigate('learn'),
      meta: t('home.c5m'),
    },
    {
      icon: '🏆',
      name: t('home.c6n'),
      desc: t('home.c6d'),
      action: () => navigate('challenges'),
      meta: t('home.c6m', { stars, lvl: nextLevel.id }),
    },
    {
      icon: '📈',
      name: t('home.c7n'),
      desc: t('home.c7d'),
      action: () => navigate('stats'),
      meta: t('home.c7m'),
    },
    {
      icon: '🛠️',
      name: t('home.c8n'),
      desc: t('home.c8d'),
      action: () => navigate('editor'),
      meta: t('home.c8m'),
    },
    {
      icon: '⚙️',
      name: t('home.c9n'),
      desc: t('home.c9d'),
      action: () => navigate('settings'),
      meta: t('home.c9m'),
    },
  ];

  return (
    <div>
      <h1 className="page-title">{t('home.title')}</h1>
      <p className="page-sub">{t('home.sub')}</p>
      <div className="grid-cards">
        {cards.map((c) => (
          <button key={c.name} className="card" onClick={c.action}>
            <span className="card-icon" aria-hidden="true">{c.icon}</span>
            <span className="card-name">{c.name}</span>
            <span className="card-desc">{c.desc}</span>
            <span className="card-meta">{c.meta}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
