'use client';

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { DashboardLayout } from '@/components/layout/DashboardLayout';
import { api } from '@/lib/api';
import { useState } from 'react';
import { Plus, Bus, Users, Pencil, UserPlus, X } from 'lucide-react';

interface TransportRoute {
  id: string; name: string; description?: string | null; driverName?: string | null;
  driverPhone?: string | null; vehicleNo?: string | null; capacity: number; _count?: { students: number };
}
const EMPTY = { name: '', description: '', driverName: '', driverPhone: '', vehicleNo: '', capacity: 20 };

function RouteCard({ route, onEdit, onManageStudents }: { route: TransportRoute; onEdit: () => void; onManageStudents: () => void }) {
  const occupancy = route.capacity ? Math.min(100, Math.round(((route._count?.students ?? 0) / route.capacity) * 100)) : 0;
  return <div className="card">
    <div className="flex items-start justify-between mb-3">
      <div className="flex items-center gap-3"><div className="w-10 h-10 rounded-xl bg-orange-50 flex items-center justify-center"><Bus className="w-5 h-5 text-orange-500" /></div><div><h3 className="font-semibold text-gray-900">{route.name}</h3><p className="text-xs text-gray-500">{route.driverName || 'No driver assigned'}{route.driverPhone ? ` · ${route.driverPhone}` : ''}</p></div></div>
      <button aria-label={`Edit ${route.name}`} onClick={onEdit} className="p-2 text-gray-400 hover:text-primary-600 rounded-lg hover:bg-primary-50"><Pencil className="w-4 h-4" /></button>
    </div>
    {route.description && <p className="text-sm text-gray-600 mb-3">{route.description}</p>}
    <div className="flex items-center gap-4 text-sm text-gray-600 mb-3"><span className="flex items-center gap-1"><Users className="w-3.5 h-3.5 text-gray-400" />{route._count?.students ?? 0}/{route.capacity}</span><span className="text-xs text-gray-400 ml-auto">{route.vehicleNo || 'No vehicle assigned'}</span></div>
    <div><div className="flex justify-between text-xs text-gray-500 mb-1"><span>Capacity</span><span>{occupancy}%</span></div><div className="w-full h-1.5 bg-gray-100 rounded-full overflow-hidden"><div className={`h-full rounded-full ${occupancy > 90 ? 'bg-red-500' : occupancy > 70 ? 'bg-yellow-500' : 'bg-green-500'}`} style={{ width: `${occupancy}%` }} /></div></div>
    <button className="btn-secondary mt-4 w-full justify-center text-sm" onClick={onManageStudents}><UserPlus className="w-4 h-4" /> Manage students</button>
  </div>;
}

export default function TransportPage() {
  const qc = useQueryClient();
  const [editor, setEditor] = useState<TransportRoute | null | false>(false);
  const [form, setForm] = useState(EMPTY);
  const [selectedRoute, setSelectedRoute] = useState<TransportRoute | null>(null);
  const [studentId, setStudentId] = useState('');
  const { data = [], isLoading } = useQuery({ queryKey: ['routes'], queryFn: () => api.get('/transport').then(r => r.data.data) });
  const save = useMutation({
    mutationFn: () => editor ? api.put(`/transport/${editor.id}`, form) : api.post('/transport', form),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['routes'] }); setEditor(false); },
  });
  const { data: routeStudents = [] } = useQuery({ queryKey: ['route-students', selectedRoute?.id], queryFn: () => api.get(`/transport/routes/${selectedRoute!.id}/students`).then(r => r.data.data), enabled: !!selectedRoute });
  const { data: unassignedStudents = [] } = useQuery({ queryKey: ['unassigned-transport-students'], queryFn: () => api.get('/transport/students/unassigned').then(r => r.data.data), enabled: !!selectedRoute });
  const assignStudent = useMutation({
    mutationFn: () => api.post(`/transport/routes/${selectedRoute!.id}/assign`, { studentId }),
    onSuccess: () => { setStudentId(''); qc.invalidateQueries({ queryKey: ['routes'] }); qc.invalidateQueries({ queryKey: ['route-students', selectedRoute?.id] }); qc.invalidateQueries({ queryKey: ['unassigned-transport-students'] }); },
  });
  const unassignStudent = useMutation({
    mutationFn: (id: string) => api.delete(`/transport/routes/${selectedRoute!.id}/assign/${id}`),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['routes'] }); qc.invalidateQueries({ queryKey: ['route-students', selectedRoute?.id] }); qc.invalidateQueries({ queryKey: ['unassigned-transport-students'] }); },
  });
  const openEditor = (route?: TransportRoute) => { setEditor(route || null); setForm(route ? { name: route.name, description: route.description || '', driverName: route.driverName || '', driverPhone: route.driverPhone || '', vehicleNo: route.vehicleNo || '', capacity: route.capacity } : EMPTY); save.reset(); };
  const routes: TransportRoute[] = data;
  const assigned = routes.reduce((sum, route) => sum + (route._count?.students ?? 0), 0);

  return <DashboardLayout title="Transport" subtitle={`${routes.length} routes · ${assigned} students`} allowedRoles={['ADMIN']} actions={<button className="btn-primary" onClick={() => openEditor()}><Plus className="w-4 h-4" /> Add Route</button>}>
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-4">{[{ label: 'Total Routes', value: routes.length, icon: Bus }, { label: 'Students Assigned', value: assigned, icon: Users }].map(s => <div key={s.label} className="stat-card"><div className="stat-icon bg-orange-50"><s.icon className="w-5 h-5 text-orange-600" /></div><div><p className="text-xl font-bold text-gray-900">{s.value}</p><p className="text-sm text-gray-500">{s.label}</p></div></div>)}</div>
      {isLoading ? <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">{[...Array(3)].map((_, i) => <div key={i} className="skeleton h-48 rounded-2xl" />)}</div> : routes.length ? <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">{routes.map(route => <RouteCard key={route.id} route={route} onEdit={() => openEditor(route)} onManageStudents={() => { setSelectedRoute(route); setStudentId(''); assignStudent.reset(); unassignStudent.reset(); }} />)}</div> : <div className="empty-state"><div className="empty-state-icon"><Bus className="w-6 h-6 text-gray-400" /></div><p className="empty-state-title">No routes configured</p><p className="empty-state-desc">Add your first bus route to manage student transport.</p></div>}
    </div>
    {selectedRoute && <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"><div className="bg-white rounded-2xl shadow-xl w-full max-w-lg p-6"><div className="flex items-center justify-between mb-4"><div><h2 className="text-lg font-semibold">Students on {selectedRoute.name}</h2><p className="text-xs text-gray-500">Capacity: {routeStudents.length}/{selectedRoute.capacity}</p></div><button aria-label="Close" onClick={() => setSelectedRoute(null)} className="p-2 text-gray-500"><X className="w-4 h-4" /></button></div><div className="flex gap-2"><select className="select flex-1" value={studentId} onChange={event => setStudentId(event.target.value)}><option value="">Choose an unassigned student…</option>{unassignedStudents.map((student: any) => <option key={student.id} value={student.id}>{student.user?.name} · {student.admissionNo}{student.class?.name ? ` · ${student.class.name}` : ''}</option>)}</select><button className="btn-primary" disabled={!studentId || assignStudent.isPending || routeStudents.length >= selectedRoute.capacity} onClick={() => assignStudent.mutate()}>{assignStudent.isPending ? 'Adding…' : 'Assign'}</button></div>{assignStudent.isError && <p role="alert" className="text-sm text-red-600 mt-2">Couldn’t assign the student. The route may be full or the student may already be assigned elsewhere.</p>}{unassignStudent.isError && <p role="alert" className="text-sm text-red-600 mt-2">Couldn’t remove that student from the route.</p>}<div className="mt-5 max-h-72 overflow-y-auto divide-y">{routeStudents.length ? routeStudents.map((student: any) => <div key={student.id} className="flex items-center justify-between py-3"><div><p className="text-sm font-medium text-gray-800">{student.user?.name}</p><p className="text-xs text-gray-500">{student.admissionNo}{student.class?.name ? ` · ${student.class.name}` : ''}</p></div><button aria-label={`Remove ${student.user?.name} from route`} className="p-2 text-gray-400 hover:text-red-600" disabled={unassignStudent.isPending} onClick={() => unassignStudent.mutate(student.id)}><X className="w-4 h-4" /></button></div>) : <p className="text-sm text-gray-400 py-6 text-center">No students assigned yet.</p>}</div></div></div>}
    {editor !== false && <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"><div className="bg-white rounded-2xl shadow-xl w-full max-w-md p-6"><h2 className="text-lg font-semibold mb-4">{editor ? 'Edit Route' : 'Add Route'}</h2><div className="space-y-3"><label className="label">Route name<input className="input mt-1" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} /></label><label className="label">Description<input className="input mt-1" value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} /></label><div className="grid grid-cols-2 gap-3"><label className="label">Driver name<input className="input mt-1" value={form.driverName} onChange={e => setForm(f => ({ ...f, driverName: e.target.value }))} /></label><label className="label">Driver phone<input className="input mt-1" value={form.driverPhone} onChange={e => setForm(f => ({ ...f, driverPhone: e.target.value }))} /></label><label className="label">Vehicle number<input className="input mt-1" value={form.vehicleNo} onChange={e => setForm(f => ({ ...f, vehicleNo: e.target.value }))} /></label><label className="label">Capacity<input className="input mt-1" type="number" min="1" value={form.capacity} onChange={e => setForm(f => ({ ...f, capacity: Number(e.target.value) }))} /></label></div>{save.isError && <p role="alert" className="text-sm text-red-600">Couldn’t save this route. Please check the details.</p>}</div><div className="flex gap-3 mt-5"><button className="btn-secondary flex-1" onClick={() => setEditor(false)}>Cancel</button><button className="btn-primary flex-1" disabled={!form.name.trim() || form.capacity < 1 || save.isPending} onClick={() => save.mutate()}>{save.isPending ? 'Saving…' : 'Save Route'}</button></div></div></div>}
  </DashboardLayout>;
}
