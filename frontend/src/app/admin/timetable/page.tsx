'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { DashboardLayout } from '@/components/layout/DashboardLayout';
import { classesAPI, api } from '@/lib/api';
import { useAuthStore } from '@/store/authStore';
import { Pencil, Plus, Trash2 } from 'lucide-react';

const DAYS = ['MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY'];
const EMPTY = { subjectId: '', teacherId: '', dayOfWeek: 'MONDAY', startTime: '08:00', endTime: '09:00', room: '' };

export default function TimetablePage() {
  const { user } = useAuthStore();
  const canEdit = user?.role === 'ADMIN';
  const qc = useQueryClient();
  const [selectedClass, setSelectedClass] = useState('');
  const [editingSlot, setEditingSlot] = useState<any>(null);
  const [editorOpen, setEditorOpen] = useState(false);
  const [form, setForm] = useState(EMPTY);
  const { data: classes = [] } = useQuery({ queryKey: ['classes'], queryFn: () => classesAPI.list().then(r => r.data.data?.data ?? r.data.data ?? []) });
  const { data: slots = [], isLoading } = useQuery({ queryKey: ['timetable', selectedClass], queryFn: () => api.get('/timetable', { params: { classId: selectedClass } }).then(r => r.data.data), enabled: !!selectedClass });
  const { data: subjects = [] } = useQuery({ queryKey: ['subjects'], queryFn: () => api.get('/subjects').then(r => r.data.data), enabled: canEdit });
  const { data: teachers = [] } = useQuery({ queryKey: ['teachers'], queryFn: () => api.get('/teachers').then(r => r.data.data), enabled: canEdit });
  const save = useMutation({
    mutationFn: () => editingSlot ? api.put(`/timetable/${editingSlot.id}`, { ...form, classId: selectedClass, room: form.room || null }) : api.post('/timetable', { ...form, classId: selectedClass, room: form.room || null }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['timetable', selectedClass] }); setEditorOpen(false); setEditingSlot(null); },
  });
  const remove = useMutation({
    mutationFn: (slotId: string) => api.delete(`/timetable/${slotId}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['timetable', selectedClass] }),
  });
  const openEditor = (slot?: any) => { setEditingSlot(slot || null); setForm(slot ? { subjectId: slot.subjectId, teacherId: slot.teacherId, dayOfWeek: slot.dayOfWeek, startTime: slot.startTime, endTime: slot.endTime, room: slot.room || '' } : EMPTY); save.reset(); setEditorOpen(true); };

  return <DashboardLayout title="Timetable">
    <div className="space-y-5">
      <div className="flex justify-between items-center gap-3"><select value={selectedClass} onChange={e => setSelectedClass(e.target.value)} className="input w-56"><option value="">Select class…</option>{classes.map((c: any) => <option key={c.id} value={c.id}>{c.name}</option>)}</select>{canEdit && selectedClass && <button className="btn-primary" onClick={() => openEditor()}><Plus className="w-4 h-4" /> Add Period</button>}</div>
      {!selectedClass ? <div className="card text-center py-16"><p className="text-gray-500 font-medium">Select a class to view its timetable</p></div> : isLoading ? <div className="card skeleton h-64" /> : <div className="grid grid-cols-1 lg:grid-cols-5 gap-4">{DAYS.map(day => {
        const daySlots = (slots as any[]).filter(slot => slot.dayOfWeek === day).sort((a, b) => a.startTime.localeCompare(b.startTime));
        return <section key={day} className="card min-h-52"><h2 className="font-semibold text-gray-700 border-b pb-2 mb-3">{day.charAt(0) + day.slice(1).toLowerCase()}</h2>{daySlots.length ? <div className="space-y-2">{daySlots.map(slot => <div key={slot.id} className="rounded-xl border border-primary-100 bg-primary-50/60 p-3"><div className="flex justify-between gap-2"><p className="font-medium text-sm text-gray-900">{slot.subject?.name || 'Subject'}</p>{canEdit && <div className="flex gap-2"><button aria-label="Edit timetable period" onClick={() => openEditor(slot)} className="text-gray-400 hover:text-primary-600"><Pencil className="w-4 h-4" /></button><button aria-label={`Delete ${slot.subject?.name || 'timetable'} period`} disabled={remove.isPending} onClick={() => { if (window.confirm('Remove this timetable period?')) remove.mutate(slot.id); }} className="text-gray-400 hover:text-red-600"><Trash2 className="w-4 h-4" /></button></div>}</div><p className="text-xs text-gray-600 mt-1">{slot.startTime}–{slot.endTime}</p><p className="text-xs text-gray-500">{slot.teacher?.user?.name || 'Teacher not set'}{slot.room ? ` · ${slot.room}` : ''}</p></div>)}</div> : <p className="text-sm text-gray-300 text-center py-6">No periods</p>}</section>;
      })}</div>}
    </div>
    {remove.isError && <p role="alert" className="text-sm text-red-600">Couldn’t remove the timetable period.</p>}
    {editorOpen && <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"><div className="bg-white rounded-2xl shadow-xl w-full max-w-lg p-6"><h2 className="text-lg font-semibold mb-4">{editingSlot ? 'Edit Period' : 'Add Period'}</h2><div className="grid grid-cols-2 gap-3"><label className="label">Subject<select className="select mt-1" value={form.subjectId} onChange={e => setForm(f => ({ ...f, subjectId: e.target.value }))}><option value="">Select subject</option>{subjects.map((s: any) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></label><label className="label">Teacher<select className="select mt-1" value={form.teacherId} onChange={e => setForm(f => ({ ...f, teacherId: e.target.value }))}><option value="">Select teacher</option>{teachers.map((t: any) => <option key={t.id} value={t.id}>{t.user?.name || t.name}</option>)}</select></label><label className="label">Day<select className="select mt-1" value={form.dayOfWeek} onChange={e => setForm(f => ({ ...f, dayOfWeek: e.target.value }))}>{DAYS.map(day => <option key={day} value={day}>{day.charAt(0) + day.slice(1).toLowerCase()}</option>)}</select></label><label className="label">Room<input className="input mt-1" value={form.room} onChange={e => setForm(f => ({ ...f, room: e.target.value }))} /></label><label className="label">Start<input type="time" className="input mt-1" value={form.startTime} onChange={e => setForm(f => ({ ...f, startTime: e.target.value }))} /></label><label className="label">End<input type="time" className="input mt-1" value={form.endTime} onChange={e => setForm(f => ({ ...f, endTime: e.target.value }))} /></label></div>{save.isError && <p role="alert" className="text-sm text-red-600 mt-3">{(save.error as any)?.response?.data?.message || 'Couldn’t save this period. Check that all fields are valid and the schedule has no conflicts.'}</p>}<div className="flex gap-3 mt-6"><button className="btn-secondary flex-1" onClick={() => setEditorOpen(false)}>Cancel</button><button className="btn-primary flex-1" disabled={!form.subjectId || !form.teacherId || form.endTime <= form.startTime || save.isPending} onClick={() => save.mutate()}>{save.isPending ? 'Saving…' : 'Save Period'}</button></div></div></div>}
  </DashboardLayout>;
}
