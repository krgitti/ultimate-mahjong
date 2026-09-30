import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { ToastHost } from '../components/ui';
import { setSoundEnabled } from '../components/sound';
import { loadSettings, saveSettings, type Settings } from '../storage/profile';
import { HomeScreen } from '../features/home/HomeScreen';
import { SolitaireScreen } from '../features/solitaire/SolitaireScreen';
import { TraditionalScreen } from '../features/traditional/TraditionalScreen';
import { LearnScreen } from '../features/tutorial/LearnScreen';
import { ChallengesScreen } from '../features/challenges/ChallengesScreen';
import { StatsScreen } from '../features/profile/StatsScreen';
import { SettingsScreen } from '../features/profile/SettingsScreen';
import { EditorScreen } from '../features/solitaire/EditorScreen';

export type Route =
  | { name: 'home' }
  | { name: 'solitaire' }
  | { name: 'traditional' }
  | { name: 'learn' }
  | { name: 'challenges' }
  | { name: 'stats' }
  | { name: 'settings' }
  | { name: 'editor' };

/** Payloads handed to game screens when launched from campaign/challenges. */
export interface SolitaireLaunch {
  layoutId?: string;
  seed?: number;
  levelId?: number; // campaign level
  challengeId?: string;
  timeLimitMs?: number | null;
  maxHints?: number | null;
  maxShuffles?: number | null;
}

function parseHash(): Route {
  const h = window.location.hash.replace(/^#\/?/, '');
  switch (h) {
    case 'solitaire': return { name: 'solitaire' };
    case 'traditional': return { name: 'traditional' };
    case 'learn': return { name: 'learn' };
    case 'challenges': return { name: 'challenges' };
    case 'stats': return { name: 'stats' };
    case 'settings': return { name: 'settings' };
    case 'editor': return { name: 'editor' };
    default: return { name: 'home' };
  }
}

const NAV: { route: string; label: string }[] = [
  { route: '', label: 'Início' },
  { route: 'solitaire', label: 'Solitaire' },
  { route: 'traditional', label: 'Tradicional' },
  { route: 'learn', label: 'Aprender' },
  { route: 'challenges', label: 'Desafios' },
  { route: 'stats', label: 'Estatísticas' },
  { route: 'settings', label: 'Config' },
];

export function navigate(path: string) {
  window.location.hash = path ? `#/${path}` : '#/';
}

export function App() {
  const [route, setRoute] = useState<Route>(parseHash);
  const [settings, setSettings] = useState<Settings>(() => loadSettings());
  const [solitaireLaunch, setSolitaireLaunch] = useState<SolitaireLaunch | null>(null);

  useEffect(() => {
    const onHash = () => setRoute(parseHash());
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  useEffect(() => {
    document.documentElement.style.setProperty('--scale', String(settings.uiScale));
    document.body.classList.toggle('contrast-high', settings.highContrast);
    setSoundEnabled(settings.sound);
  }, [settings]);

  const updateSettings = useCallback((patch: Partial<Settings>) => {
    setSettings((prev) => {
      const next = { ...prev, ...patch };
      saveSettings(next);
      return next;
    });
  }, []);

  const launchSolitaire = useCallback((launch: SolitaireLaunch | null) => {
    setSolitaireLaunch(launch);
    navigate('solitaire');
  }, []);

  let page: ReactNode;
  switch (route.name) {
    case 'solitaire':
      page = <SolitaireScreen key={JSON.stringify(solitaireLaunch)} launch={solitaireLaunch} />;
      break;
    case 'traditional':
      page = <TraditionalScreen settings={settings} />;
      break;
    case 'learn':
      page = <LearnScreen />;
      break;
    case 'challenges':
      page = <ChallengesScreen onLaunch={launchSolitaire} />;
      break;
    case 'stats':
      page = <StatsScreen />;
      break;
    case 'settings':
      page = <SettingsScreen settings={settings} onChange={updateSettings} />;
      break;
    case 'editor':
      page = <EditorScreen />;
      break;
    default:
      page = <HomeScreen onLaunchSolitaire={launchSolitaire} />;
  }

  const currentPath =
    route.name === 'home' ? '' : route.name;

  return (
    <ToastHost>
      <div className="app-shell">
        <header className="topbar">
          <div className="brand">
            <span className="brand-mark" aria-hidden="true">🀄</span>
            <span className="brand-name">Ultimate <em>Mahjong</em> Online</span>
          </div>
          <nav className="nav" aria-label="Navegação principal">
            {NAV.map((n) => (
              <button
                key={n.route}
                className="nav-link"
                aria-current={currentPath === n.route ? 'page' : undefined}
                onClick={() => {
                  if (n.route === 'solitaire') launchSolitaire(null);
                  else navigate(n.route);
                }}
              >
                {n.label}
              </button>
            ))}
          </nav>
        </header>
        <main className="page">{page}</main>
      </div>
    </ToastHost>
  );
}
