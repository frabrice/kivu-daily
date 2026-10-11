import { useState } from 'react';
import { ChevronDown, ChevronUp, BookOpen, Lightbulb } from 'lucide-react';
import { NavItem, NavKey } from '../components/AppShell';
import { HELP_CONTENT } from '../lib/helpContent';

interface HowToUsePageProps {
  navItems: NavItem[];
}

export default function HowToUsePage({ navItems }: HowToUsePageProps) {
  const entries = navItems.filter((n) => n.key !== 'help' && HELP_CONTENT[n.key]);
  const [expanded, setExpanded] = useState<Set<NavKey>>(new Set());

  const toggle = (key: NavKey) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const expandAll = () => setExpanded(new Set(entries.map((e) => e.key)));
  const collapseAll = () => setExpanded(new Set());

  return (
    <div className="space-y-4">
      <div className="card p-5 flex items-start gap-3 bg-gradient-to-br from-navy-800 to-brand-700 text-white">
        <div className="w-9 h-9 rounded-xl bg-white/20 flex items-center justify-center shrink-0">
          <BookOpen size={18} />
        </div>
        <div>
          <h2 className="text-ui font-semibold">How to Use Kivu Daily</h2>
          <p className="text-caption text-white/80 mt-0.5">
            A full walkthrough of every page you have access to — what's on it, what happens when you click each thing, and tips for using it well.
            This list matches your own menus, so you'll only see pages you actually have.
          </p>
        </div>
      </div>

      <div className="flex justify-end gap-3">
        <button onClick={expandAll} className="text-caption text-brand-600 dark:text-brand-300 hover:underline">Expand all</button>
        <span className="text-fg-subtle ">|</span>
        <button onClick={collapseAll} className="text-caption text-fg-subtle hover:underline">Collapse all</button>
      </div>

      <div className="space-y-2.5">
        {entries.map((item) => {
          const content = HELP_CONTENT[item.key]!;
          const isOpen = expanded.has(item.key);
          const Icon = item.icon;
          return (
            <div key={item.key} className="card overflow-hidden">
              <button
                onClick={() => toggle(item.key)}
                className="w-full flex items-center gap-3 p-4 text-left hover:bg-hover transition-colors"
              >
                <div className="w-9 h-9 rounded-xl bg-brand/10 flex items-center justify-center shrink-0">
                  <Icon size={16} className="text-brand-600 dark:text-brand-300" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-small font-semibold">{item.label}</p>
                  <p className="text-caption text-fg-subtle mt-0.5 line-clamp-1">{content.blurb}</p>
                </div>
                {isOpen ? <ChevronUp size={16} className="text-fg-subtle shrink-0" /> : <ChevronDown size={16} className="text-fg-subtle shrink-0" />}
              </button>

              {isOpen && (
                <div className="px-4 pb-5 pt-1 border-t border-line-muted space-y-4 animate-fade-in">
                  <p className="text-small text-fg-muted leading-relaxed pt-3">{content.blurb}</p>

                  {content.sections.map((section) => (
                    <div key={section.heading}>
                      <h4 className="text-micro font-semibold text-fg-subtle uppercase tracking-wide mb-1.5">{section.heading}</h4>
                      <div className="space-y-1.5">
                        {section.body.map((para, i) => (
                          <p key={i} className="text-small text-fg-muted leading-relaxed">{para}</p>
                        ))}
                      </div>
                    </div>
                  ))}

                  {content.tips.length > 0 && (
                    <div className="p-3 rounded-lg bg-brand/5 border border-brand/20">
                      <div className="flex items-center gap-1.5 mb-1.5">
                        <Lightbulb size={12} className="text-brand-600 dark:text-brand-300" />
                        <h4 className="text-micro font-semibold text-brand-700 dark:text-brand-300 uppercase tracking-wide">Tips</h4>
                      </div>
                      <ul className="space-y-1">
                        {content.tips.map((tip, i) => (
                          <li key={i} className="text-caption text-fg-muted leading-relaxed flex gap-1.5">
                            <span className="text-brand-500 shrink-0">·</span>
                            <span>{tip}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
