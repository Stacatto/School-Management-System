'use client';

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { DashboardLayout } from '@/components/layout/DashboardLayout';
import { api } from '@/lib/api';
import { useState } from 'react';
import { Plus, Megaphone, Pin, Globe, Users, Clock, Pencil } from 'lucide-react';
import { useAuthStore } from '@/store/authStore';

interface Announcement {
  id: string;
  title: string;
  content: string;
  audience: string[];
  pinned: boolean;
  author?: { name: string };
  createdAt: string;
}

const ROLES = ['ADMIN', 'TEACHER', 'STUDENT', 'PARENT'];
const ROLE_LABELS: Record<string, string> = { ADMIN: 'Administrators', TEACHER: 'Teachers', STUDENT: 'Students', PARENT: 'Parents' };

function timeAgo(date: string) {
  const diff = Date.now() - new Date(date).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

export default function AnnouncementsPage() {
  const { user } = useAuthStore();
  const role = user?.role || '';
  const qc = useQueryClient();
  const [showAdd, setShowAdd] = useState(false);
  const [editing, setEditing] = useState<Announcement | null>(null);
  const [filter, setFilter] = useState<'ALL' | 'STUDENT' | 'TEACHER' | 'PARENT'>('ALL');
  const EMPTY = { title: '', content: '', audience: [...ROLES], pinned: false };
  const [form, setForm] = useState(EMPTY);

  const { data, isLoading } = useQuery({
    queryKey: ['announcements'],
    queryFn: () => api.get('/announcements').then(r => r.data.data),
  });

  const save = useMutation({
    mutationFn: (body: typeof form) => editing ? api.put(`/announcements/${editing.id}`, body) : api.post('/announcements', body),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['announcements'] }); setShowAdd(false); setEditing(null); setForm(EMPTY); },
  });

  const openEditor = (announcement?: Announcement) => {
    setEditing(announcement || null);
    setForm(announcement ? { title: announcement.title, content: announcement.content, audience: announcement.audience, pinned: announcement.pinned } : EMPTY);
    save.reset(); setShowAdd(true);
  };

  const announcements: Announcement[] = (data || []).filter((a: Announcement) =>
    filter === 'ALL' || a.audience.includes(filter) || a.audience.includes('ALL')
  );

  const pinned = announcements.filter(a => a.pinned);
  const regular = announcements.filter(a => !a.pinned);
  const canCreate = role === 'ADMIN' || role === 'TEACHER';

  return (
    <DashboardLayout
      title="Announcements"
      subtitle={`${announcements.length} announcements`}
      allowedRoles={['ADMIN', 'TEACHER', 'STUDENT', 'PARENT']}
      actions={
        canCreate ? (
          <button className="btn-primary" onClick={() => openEditor()}>
            <Plus className="w-4 h-4" /> Post Announcement
          </button>
        ) : undefined
      }
    >
      <div className="space-y-6">
        {/* Audience filter */}
        <div className="flex items-center gap-2 flex-wrap">
          {(['ALL', 'STUDENT', 'TEACHER', 'PARENT'] as const).map(f => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`px-3 py-1.5 rounded-xl text-sm font-medium transition-all ${filter === f ? 'bg-primary-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}
            >
              {f === 'ALL' ? 'All' : ROLE_LABELS[f]}
            </button>
          ))}
        </div>

        {isLoading ? (
          <div className="space-y-3">
            {[...Array(4)].map((_, i) => <div key={i} className="skeleton h-28 rounded-2xl" />)}
          </div>
        ) : (
          <div className="space-y-6">
            {pinned.length > 0 && (
              <div>
                <p className="text-xs font-semibold text-gray-400 uppercase tracking-widest mb-3 flex items-center gap-1.5">
                  <Pin className="w-3 h-3" /> Pinned
                </p>
                <div className="space-y-3">
                  {pinned.map(a => <AnnouncementCard key={a.id} a={a} canEdit={canCreate} onEdit={() => openEditor(a)} />)}
                </div>
              </div>
            )}

            {regular.length > 0 && (
              <div>
                {pinned.length > 0 && <p className="text-xs font-semibold text-gray-400 uppercase tracking-widest mb-3">Recent</p>}
                <div className="space-y-3">
                  {regular.map(a => <AnnouncementCard key={a.id} a={a} canEdit={canCreate} onEdit={() => openEditor(a)} />)}
                </div>
              </div>
            )}

            {announcements.length === 0 && (
              <div className="empty-state">
                <div className="empty-state-icon"><Megaphone className="w-6 h-6 text-gray-400" /></div>
                <p className="empty-state-title">No announcements</p>
                <p className="empty-state-desc">Nothing here yet. Check back later.</p>
              </div>
            )}
          </div>
        )}
      </div>

      {showAdd && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg p-6 animate-scale-in">
            <h2 className="text-lg font-semibold text-gray-900 mb-4">{editing ? 'Edit Announcement' : 'Post Announcement'}</h2>
            <div className="space-y-4">
              <div>
                <label className="label">Title</label>
                <input className="input" placeholder="Announcement title" value={form.title} onChange={e => setForm(f => ({ ...f, title: e.target.value }))} />
              </div>
              <div>
                <label className="label">Content</label>
                <textarea className="input resize-none" rows={4} placeholder="Write your message…" value={form.content} onChange={e => setForm(f => ({ ...f, content: e.target.value }))} />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="label">Audience</label>
                  <select className="select" value={form.audience.length === ROLES.length ? 'ALL' : form.audience[0] || ''} onChange={e => setForm(f => ({ ...f, audience: e.target.value === 'ALL' ? [...ROLES] : [e.target.value] }))}>
                    <option value="ALL">Everyone</option>
                    <option value="STUDENT">Students</option>
                    <option value="TEACHER">Teachers</option>
                    <option value="PARENT">Parents</option>
                  </select>
                </div>
              </div>
              <label className="flex items-center gap-2 cursor-pointer">
                <input type="checkbox" className="w-4 h-4 rounded" checked={form.pinned} onChange={e => setForm(f => ({ ...f, pinned: e.target.checked }))} />
                <span className="text-sm text-gray-700">Pin this announcement</span>
              </label>
            </div>
            <div className="flex gap-3 mt-6">
              <button className="btn-secondary flex-1" onClick={() => setShowAdd(false)}>Cancel</button>
              <button
                className="btn-primary flex-1"
                disabled={!form.title || !form.content || save.isPending}
                onClick={() => save.mutate(form)}
              >
                {save.isPending ? 'Saving…' : editing ? 'Save Changes' : 'Post'}
              </button>
            </div>
          </div>
        </div>
      )}
    </DashboardLayout>
  );
}

function AnnouncementCard({ a, canEdit, onEdit }: { a: Announcement; canEdit: boolean; onEdit: () => void }) {
  const [expanded, setExpanded] = useState(false);
  const label = a.audience.includes('ADMIN') && a.audience.includes('TEACHER') && a.audience.includes('STUDENT') && a.audience.includes('PARENT') ? 'Everyone' : a.audience.map(role => ROLE_LABELS[role] || role).join(', ');

  return (
    <div className={`card transition-all ${a.pinned ? 'border-primary-200 bg-primary-50/30' : ''}`}>
      <div className="flex items-start gap-3">
        <div className="w-2 h-2 rounded-full mt-2 flex-shrink-0 bg-primary-500" />
        <div className="flex-1 min-w-0">
          <div className="flex items-start justify-between gap-2 mb-1">
            <h3 className="font-semibold text-gray-900 text-sm">{a.title}</h3>
            <div className="flex items-center gap-1.5 flex-shrink-0">
              <span className="badge badge-indigo">{label}</span>
              {a.pinned && <Pin className="w-3 h-3 text-primary-500" />}
              {canEdit && <button aria-label={`Edit ${a.title}`} onClick={onEdit} className="p-1 text-gray-400 hover:text-primary-600"><Pencil className="w-4 h-4" /></button>}
            </div>
          </div>
          <p className={`text-sm text-gray-600 ${expanded ? '' : 'line-clamp-2'}`}>{a.content}</p>
          {a.content.length > 120 && (
            <button onClick={() => setExpanded(e => !e)} className="text-xs text-primary-600 hover:underline mt-1">
              {expanded ? 'Show less' : 'Read more'}
            </button>
          )}
          <div className="flex items-center gap-3 mt-2 text-xs text-gray-400">
            {a.author && <span>{a.author.name}</span>}
            <span className="flex items-center gap-1"><Clock className="w-3 h-3" />{timeAgo(a.createdAt)}</span>
          </div>
        </div>
      </div>
    </div>
  );
}
