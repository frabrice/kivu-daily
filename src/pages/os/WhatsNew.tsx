import { Link } from 'react-router-dom';
import { AppWindow, Command, Keyboard, LayoutGrid, MousePointerClick, Moon, PanelLeft, PanelRight, Rocket, Search, Smartphone, Sparkles, SunMedium } from 'lucide-react';
import { useAccess } from '../../os/access';
import { MODULES, visiblePages } from '../../os/registry';
import { Box, PageHeader } from '../../ui/kit';

const ITEMS = [
  { icon: Search, title: 'Search and jump anywhere', body: <>Press <span className="kbd">Ctrl K</span> (or <span className="kbd">/</span>) and type a driver, car, person, case or page. Enter opens it.</> },
  { icon: PanelLeft, title: 'Modules on the left', body: <>The thin bar on the left has one icon per area (Fleet, Finance, Call Center…). Hover an icon to slide its menu out; click to open it. A red dot means something there needs attention.</> },
  { icon: AppWindow, title: 'Tabs for what you have open', body: <>Every page and person you open gets a tab under the top bar, like windows on a computer. Pin the ones you use most; middle-click closes a tab.</> },
  { icon: MousePointerClick, title: 'Click any name', body: <>Names of drivers, cars, people, owners and cases are links. Click to open them in a panel on the right without leaving your page, hover for a quick summary, or Ctrl-click to open a full page in a new tab.</> },
  { icon: LayoutGrid, title: 'A page for everything', body: <>Each driver, car, owner, staff member and case now has its own page: numbers at the top, a calendar of their days, everything that happened in order, and the details on the side.</> },
  { icon: Sparkles, title: 'Numbers on every page', body: <>Each area opens with an overview: cards with the key numbers (click a card to see the list behind it), charts and a list of what needs someone today.</> },
  { icon: SunMedium, title: 'Today panel', body: <>Move your mouse to the right edge of the screen (or press <span className="kbd">t</span>) to see today's tasks and progress from any page.</> },
  { icon: Moon, title: 'A better dark mode', body: <>Dark mode has clear layers and borders now. Switch it from your picture at the top right.</> },
  { icon: Smartphone, title: 'On your phone', body: <>A bar at the bottom gives you Home, My work, your area, Search and the full menu.</> },
  { icon: Keyboard, title: 'Shortcuts', body: <>Press <span className="kbd">?</span> to see them all: <span className="kbd">g</span> then a letter jumps to an area (for example <span className="kbd">g f</span> for Fleet), <span className="kbd">[</span> hides the menu, <span className="kbd">Esc</span> closes panels.</> },
];

export default function WhatsNew() {
  const access = useAccess();
  const areas = MODULES.filter((m) => !['home', 'docs', 'admin'].includes(m.id)).map((m) => ({ m, pages: visiblePages(m, access) })).filter((x) => x.pages.length);
  return (
    <div className="max-w-4xl animate-fade-in">
      <PageHeader icon={Rocket} title="The new Kivu Daily" subtitle="Same work, same data — a faster way to find things and see how they're going." />
      <div className="grid sm:grid-cols-2 gap-3 mb-5">
        {ITEMS.map((i) => (
          <div key={i.title} className="card p-4 flex gap-3">
            <span className="w-9 h-9 rounded-lg bg-accent/10 text-accent-fg flex items-center justify-center shrink-0"><i.icon size={17} /></span>
            <div><p className="text-ui font-semibold">{i.title}</p><p className="text-body text-fg-muted mt-0.5">{i.body}</p></div>
          </div>
        ))}
      </div>
      <Box title="Where your pages are now" icon={PanelRight}>
        <div className="grid sm:grid-cols-2 gap-4">
          {areas.map(({ m, pages }) => (
            <div key={m.id}>
              <p className="text-body font-semibold flex items-center gap-1.5 mb-1"><m.icon size={14} className="text-fg-muted" /> {m.label}</p>
              <ul className="space-y-0.5">
                {pages.filter((p, i, arr) => arr.findIndex((x) => x.path === p.path) === i).map((p) => <li key={p.id}><Link to={p.path} className="link text-body">{p.label}</Link></li>)}
              </ul>
            </div>
          ))}
        </div>
      </Box>
      <p className="text-caption text-fg-muted mt-4 flex items-center gap-1.5"><Command size={12} /> Something missing or not working? Use “Flag to IT” on any driver or case, or tell the MD.</p>
    </div>
  );
}
