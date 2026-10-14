import React from 'react';
import { ModuleId } from '../../shared/types';
import {
  LayoutDashboard,
  HeartPulse,
  Sparkles,
  Layers,
  Zap,
  PackageX,
  Puzzle,
  PieChart,
  Copy,
  Flame,
  Cpu,
  Settings2,
  ChevronRight,
  ShieldAlert,
} from 'lucide-react';

interface SidebarProps {
  currentModule: ModuleId;
  onSelectModule: (module: ModuleId) => void;
  quickStats?: {
    cleanableBytes?: number;
    registryCount?: number;
    startupCount?: number;
  };
}

interface NavItem {
  id: ModuleId;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  badge?: string;
  badgeColor?: string;
}

interface NavGroup {
  groupName: string;
  items: NavItem[];
}

export const Sidebar: React.FC<SidebarProps> = ({
  currentModule,
  onSelectModule,
  quickStats,
}) => {
  const groups: NavGroup[] = [
    {
      groupName: 'OVERVIEW',
      items: [
        {
          id: 'dashboard',
          label: 'Dashboard',
          icon: LayoutDashboard,
        },
        {
          id: 'health-check',
          label: 'Health Check',
          icon: HeartPulse,
          badge: '1-Click',
          badgeColor: 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30',
        },
      ],
    },
    {
      groupName: 'CLEAN & REPAIR',
      items: [
        {
          id: 'smart-clean',
          label: 'Smart Clean',
          icon: Sparkles,
          badge: '4.8 GB',
          badgeColor: 'bg-teal-500/10 text-teal-300 border border-teal-500/20',
        },
        {
          id: 'registry-fixer',
          label: 'Registry Fixer',
          icon: Layers,
          badge: '38 Issues',
          badgeColor: 'bg-amber-500/10 text-amber-300 border border-amber-500/20',
        },
        {
          id: 'startup-optimizer',
          label: 'Startup Optimizer',
          icon: Zap,
          badge: '4 Slow',
          badgeColor: 'bg-rose-500/10 text-rose-300 border border-rose-500/20',
        },
      ],
    },
    {
      groupName: 'APPLICATIONS',
      items: [
        {
          id: 'app-remover',
          label: 'App Remover',
          icon: PackageX,
        },
        {
          id: 'extension-manager',
          label: 'Extension Manager',
          icon: Puzzle,
        },
      ],
    },
    {
      groupName: 'STORAGE & PRIVACY',
      items: [
        {
          id: 'disk-analyzer',
          label: 'Disk Analyzer',
          icon: PieChart,
        },
        {
          id: 'duplicate-finder',
          label: 'Duplicate Finder',
          icon: Copy,
        },
        {
          id: 'secure-erase',
          label: 'Secure Erase',
          icon: Flame,
          badge: 'Military',
          badgeColor: 'bg-rose-500/10 text-rose-400 border border-rose-500/20',
        },
      ],
    },
    {
      groupName: 'SYSTEM & CONFIG',
      items: [
        {
          id: 'system-info',
          label: 'System Info',
          icon: Cpu,
        },
        {
          id: 'settings',
          label: 'Settings',
          icon: Settings2,
        },
      ],
    },
  ];

  return (
    <aside className="w-64 bg-[#0A0D14] border-r border-slate-800/80 flex flex-col justify-between shrink-0 select-none overflow-hidden">
      {/* Navigation List */}
      <div className="flex-1 overflow-y-auto px-3 py-4 space-y-6">
        {groups.map((group) => (
          <div key={group.groupName} className="space-y-1">
            <h4 className="px-3 text-[10px] font-bold tracking-wider text-slate-500 uppercase">
              {group.groupName}
            </h4>
            <div className="space-y-0.5 pt-1">
              {group.items.map((item) => {
                const Icon = item.icon;
                const isActive = currentModule === item.id;
                return (
                  <button
                    key={item.id}
                    onClick={() => onSelectModule(item.id)}
                    className={`w-full flex items-center justify-between px-3 py-2 rounded-lg text-xs font-medium transition-all group relative ${
                      isActive
                        ? 'bg-gradient-to-r from-emerald-500/15 to-teal-500/10 text-emerald-300 font-semibold border border-emerald-500/30 shadow-sm shadow-emerald-950/50'
                        : 'text-slate-400 hover:text-slate-200 hover:bg-slate-900/80'
                    }`}
                  >
                    <div className="flex items-center gap-2.5">
                      <div
                        className={`p-1 rounded-md transition-colors ${
                          isActive
                            ? 'text-emerald-400'
                            : 'text-slate-400 group-hover:text-slate-200'
                        }`}
                      >
                        <Icon className="w-4 h-4" />
                      </div>
                      <span className="truncate">{item.label}</span>
                    </div>

                    <div className="flex items-center gap-1.5">
                      {item.badge && (
                        <span
                          className={`text-[9px] font-semibold px-1.5 py-0.5 rounded-full ${
                            item.badgeColor || 'bg-slate-800 text-slate-300'
                          }`}
                        >
                          {item.badge}
                        </span>
                      )}
                      {isActive && (
                        <div className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                      )}
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        ))}
      </div>

      {/* Bottom Status / Mode Panel */}
      <div className="p-3 border-t border-slate-800/80 bg-slate-950/60">
        <div className="p-2.5 rounded-lg bg-slate-900/80 border border-slate-800 flex items-center gap-2.5">
          <div className="w-7 h-7 rounded-md bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center shrink-0">
            <ShieldAlert className="w-4 h-4 text-emerald-400" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-semibold text-slate-200 truncate">Offline Safe</span>
              <span className="text-[9px] text-emerald-400 font-mono">0 Telemetry</span>
            </div>
            <p className="text-[10px] text-slate-400 truncate">Full sandbox protection active</p>
          </div>
        </div>
      </div>
    </aside>
  );
};
