import { navigate, type SolitaireLaunch } from '../../app/App';
import { CAMPAIGN, loadCampaign, loadStats } from '../../storage/profile';

export function HomeScreen({ onLaunchSolitaire }: { onLaunchSolitaire: (l: SolitaireLaunch | null) => void }) {
  const stats = loadStats();
  const campaign = loadCampaign();
  const stars = Object.values(campaign).reduce((n, c) => n + (c?.stars ?? 0), 0);
  const nextLevel = CAMPAIGN.find((l) => !(campaign[l.id]?.stars > 0)) ?? CAMPAIGN[0];

  const cards = [
    {
      icon: '🀫',
      name: 'Jogar Solitaire',
      desc: 'Combine pares de peças livres e limpe o tabuleiro. 23 layouts, dicas, desfazer e campanhas.',
      action: () => onLaunchSolitaire(null),
      meta: `${stats.solitaire.gamesWon} vitórias`,
    },
    {
      icon: '🎴',
      name: 'Mahjong Tradicional',
      desc: 'Hong Kong Mahjong: 4 assentos, você contra 3 bots. Chamadas, fan e pagamento real.',
      action: () => navigate('traditional'),
      meta: `${stats.traditional.handsWon}/${stats.traditional.handsPlayed} mãos vencidas`,
    },
    {
      icon: '🤖',
      name: 'Jogar contra IA',
      desc: 'Três níveis de bots: heurísticas de shanten, segurança e valor de mão. Escolha a dificuldade em Config.',
      action: () => navigate('traditional'),
      meta: 'Fácil · Médio · Difícil',
    },
    {
      icon: '🎓',
      name: 'Aprender',
      desc: 'Tutoriais interativos: liberdade e camadas no Solitaire; compras, chamadas e vitória no Tradicional.',
      action: () => navigate('learn'),
      meta: '2 trilhas guiadas',
    },
    {
      icon: '🏆',
      name: 'Desafios',
      desc: 'Tabuleiros determinísticos com sementes fixas, contrarrelógio e restrições de dicas.',
      action: () => navigate('challenges'),
      meta: `${Object.keys(campaign).length ? `${stars}★` : ''} campanha nível ${nextLevel.id}`,
    },
    {
      icon: '📈',
      name: 'Estatísticas',
      desc: 'Histórico de partidas, melhor pontuação, vitórias por tsumo/ron e tempo total de jogo.',
      action: () => navigate('stats'),
      meta: 'Salvo localmente',
    },
    {
      icon: '🛠️',
      name: 'Editor de layouts',
      desc: 'Desenhe seu próprio tabuleiro de Solitaire, camada por camada, e jogue nele.',
      action: () => navigate('editor'),
      meta: 'Layouts personalizados',
    },
    {
      icon: '⚙️',
      name: 'Configurações',
      desc: 'Som, escala da interface, alto contraste, regras de combinação, regras de Hong Kong e dificuldade.',
      action: () => navigate('settings'),
      meta: 'Perfil local',
    },
  ];

  return (
    <div>
      <h1 className="page-title">Bem-vindo à mesa</h1>
      <p className="page-sub">
        Duas modalidades completas: o clássico <strong>Mahjong Solitaire</strong> (pares de peças livres) e o{' '}
        <strong>Mahjong tradicional de 4 jogadores</strong> na variante Hong Kong, com motor de regras testado,
        bots com estratégia real e progresso salvo no seu navegador.
      </p>
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
