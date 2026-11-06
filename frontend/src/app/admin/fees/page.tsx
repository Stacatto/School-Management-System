'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { DashboardLayout } from '@/components/layout/DashboardLayout';
import { api, feesAPI } from '@/lib/api';
import { formatCurrency, formatDate } from '@/lib/utils';
import { DollarSign, TrendingUp, AlertTriangle, CheckCircle2, Clock, Plus, ArrowRight, Download, Pencil } from 'lucide-react';
import { useAuthStore } from '@/store/authStore';

type Payment = {
  id: string; amount: number; status: 'PAID' | 'PENDING' | 'OVERDUE' | 'PARTIAL';
  student?: { user?: { name?: string }; admissionNo?: string };
  fee?: { name?: string; dueDate?: string };
  method?: string; createdAt?: string;
};

const LANES = [
  { key: 'OVERDUE',  label: 'Overdue',  icon: AlertTriangle,  bg: 'bg-red-50',    border: 'border-red-200',  badge: 'bg-red-100 text-red-700',    dot: 'bg-red-500'    },
  { key: 'PENDING',  label: 'Pending',  icon: Clock,          bg: 'bg-amber-50',  border: 'border-amber-200',badge: 'bg-amber-100 text-amber-700', dot: 'bg-amber-500'  },
  { key: 'PARTIAL',  label: 'Partial',  icon: TrendingUp,     bg: 'bg-blue-50',   border: 'border-blue-200', badge: 'bg-blue-100 text-blue-700',   dot: 'bg-blue-500'   },
  { key: 'PAID',     label: 'Paid',     icon: CheckCircle2,   bg: 'bg-green-50',  border: 'border-green-200',badge: 'bg-green-100 text-green-700', dot: 'bg-green-500'  },
] as const;

function PaymentCard({ payment, lane }: { payment: Payment; lane: typeof LANES[number] }) {
  return (
    <div className={`bg-white rounded-xl border ${lane.border} p-3.5 shadow-sm hover:shadow-md transition-all cursor-default group`}>
      <div className="flex items-start justify-between gap-2 mb-2">
        <div className="flex items-center gap-2 min-w-0">
          <div className="w-7 h-7 rounded-full bg-gray-100 flex items-center justify-center text-xs font-bold text-gray-600 flex-shrink-0">
            {payment.student?.user?.name?.[0] || '?'}
          </div>
          <div className="min-w-0">
            <p className="text-sm font-semibold text-gray-900 truncate">{payment.student?.user?.name || '—'}</p>
            <p className="text-[11px] text-gray-400 truncate">{payment.student?.admissionNo}</p>
          </div>
        </div>
        <span className="text-sm font-bold text-gray-900 flex-shrink-0">{formatCurrency(payment.amount)}</span>
      </div>
      <p className="text-xs text-gray-500 truncate mb-2">{payment.fee?.name}</p>
      <div className="flex items-center justify-between">
        {payment.fee?.dueDate && (
          <span className="text-[11px] text-gray-400">Due {formatDate(payment.fee.dueDate)}</span>
        )}
        {payment.method && (
          <span className="text-[11px] bg-gray-100 text-gray-500 px-2 py-0.5 rounded-full">{payment.method}</span>
        )}
      </div>
    </div>
  );
}

export default function FeesPage() {
  const { user } = useAuthStore();
  const canManage = user?.role === 'ADMIN';
  const qc = useQueryClient();
  const [activeTab, setActiveTab] = useState<'kanban' | 'list'>('kanban');
  const [feeEditor, setFeeEditor] = useState<any>(null);
  const [feeForm, setFeeForm] = useState({ name: '', amount: '', dueDate: '', description: '', academicYear: '2026-2027' });
  const [assignmentEditor, setAssignmentEditor] = useState(false);
  const [assignmentForm, setAssignmentForm] = useState({ feeId: '', studentIds: [] as string[] });
  const [paymentEditor, setPaymentEditor] = useState<any>(null);
  const [paymentForm, setPaymentForm] = useState({ amount: '', method: 'CASH' });

  const { data: fees } = useQuery({
    queryKey: ['fees'],
    queryFn: () => feesAPI.list().then(r => r.data.data),
  });

  const { data: payments = [] } = useQuery({
    queryKey: ['fee-payments', user?.role],
    queryFn: () => (canManage ? feesAPI.payments() : feesAPI.myPayments()).then(r => r.data.data),
  });

  const { data: feeAssignments = [] } = useQuery({
    queryKey: [canManage ? 'fee-assignments' : 'my-fee-assignments'],
    queryFn: () => (canManage ? feesAPI.assignments() : feesAPI.myAssignments()).then(r => r.data.data),
  });
  const { data: studentResponse } = useQuery({
    queryKey: ['students-all'],
    queryFn: () => api.get('/students', { params: { limit: 500 } }).then(r => r.data),
    enabled: canManage && assignmentEditor,
  });
  const students = studentResponse?.data || [];

  const saveFee = useMutation({
    mutationFn: () => {
      const body = { ...feeForm, amount: Number(feeForm.amount), dueDate: feeForm.dueDate ? new Date(feeForm.dueDate).toISOString() : null };
      return feeEditor?.id ? api.put(`/fees/${feeEditor.id}`, body) : api.post('/fees', body);
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['fees'] }); setFeeEditor(null); },
  });
  const assignFee = useMutation({
    mutationFn: () => feesAPI.assign(assignmentForm),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['fee-assignments'] }); setAssignmentEditor(false); setAssignmentForm({ feeId: '', studentIds: [] }); },
  });
  const recordAssignmentPayment = useMutation({
    mutationFn: () => feesAPI.recordAssignmentPayment(paymentEditor.id, { amount: Number(paymentForm.amount), method: paymentForm.method }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['fee-assignments'] }); qc.invalidateQueries({ queryKey: ['fee-payments'] }); setPaymentEditor(null); },
  });
  const removeFeeAssignment = useMutation({
    mutationFn: feesAPI.removeAssignment,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['fee-assignments'] }),
  });
  const openFeeEditor = (fee?: any) => {
    setFeeEditor(fee || {});
    setFeeForm(fee ? { name: fee.name, amount: String(fee.amount), dueDate: fee.dueDate ? new Date(fee.dueDate).toISOString().slice(0, 16) : '', description: fee.description || '', academicYear: fee.academicYear } : { name: '', amount: '', dueDate: '', description: '', academicYear: '2026-2027' });
    saveFee.reset();
  };

  const allPayments: Payment[] = payments as Payment[];

  // Auto-classify payments that are past due as OVERDUE
  const enriched = allPayments.map(p => {
    if (p.status === 'PENDING' && p.fee?.dueDate && new Date(p.fee.dueDate) < new Date()) {
      return { ...p, status: 'OVERDUE' as const };
    }
    return p;
  });

  const byLane = LANES.reduce((acc, lane) => {
    acc[lane.key] = enriched.filter(p => p.status === lane.key);
    return acc;
  }, {} as Record<string, Payment[]>);

  const totalCollected = enriched.filter(p => p.status === 'PAID').reduce((s, p) => s + p.amount, 0);
  const totalPending   = enriched.filter(p => p.status === 'PENDING').reduce((s, p) => s + p.amount, 0);
  const totalOverdue   = enriched.filter(p => p.status === 'OVERDUE').reduce((s, p) => s + p.amount, 0);
  const collectionRate = enriched.length
    ? Math.round((enriched.filter(p => p.status === 'PAID').length / enriched.length) * 100) : 0;
  const exportPayments = () => {
    const rows = [['Student', 'Admission Number', 'Fee', 'Amount', 'Method', 'Status', 'Date'], ...enriched.map(p => [p.student?.user?.name || '', p.student?.admissionNo || '', p.fee?.name || '', String(p.amount), p.method || '', p.status, p.fee?.dueDate || p.createdAt || ''])];
    const csv = rows.map(row => row.map(value => `"${String(value).replace(/"/g, '""')}"`).join(',')).join('\n');
    const link = document.createElement('a');
    link.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8;' }));
    link.download = 'school-fee-payments.csv';
    link.click();
    URL.revokeObjectURL(link.href);
  };

  return (
    <DashboardLayout title="Fee Management" allowedRoles={['ADMIN', 'STUDENT']}>
      <div className="space-y-6">
        {/* KPI row */}
        <div className="grid grid-cols-2 xl:grid-cols-4 gap-4">
          {[
            { label: 'Collected',  value: formatCurrency(totalCollected), icon: CheckCircle2, iconCls: 'text-green-600', bg: 'bg-green-50', sub: `${collectionRate}% collection rate` },
            { label: 'Pending',    value: formatCurrency(totalPending),   icon: Clock,        iconCls: 'text-amber-600', bg: 'bg-amber-50', sub: `${byLane.PENDING?.length || 0} payments` },
            { label: 'Overdue',    value: formatCurrency(totalOverdue),   icon: AlertTriangle,iconCls: 'text-red-600',   bg: 'bg-red-50',   sub: `${byLane.OVERDUE?.length || 0} payments` },
            { label: 'Transactions', value: enriched.length.toString(),  icon: DollarSign,   iconCls: 'text-indigo-600',bg: 'bg-indigo-50',sub: 'all time' },
          ].map(card => {
            const Icon = card.icon;
            return (
              <div key={card.label} className="card hover:shadow-md transition-shadow">
                <div className="flex items-center gap-3 mb-2">
                  <div className={`w-9 h-9 rounded-xl ${card.bg} flex items-center justify-center flex-shrink-0`}>
                    <Icon className={`w-5 h-5 ${card.iconCls}`} />
                  </div>
                  <p className="text-sm text-gray-500">{card.label}</p>
                </div>
                <p className="text-2xl font-bold text-gray-900 tabular-nums">{card.value}</p>
                <p className="text-xs text-gray-400 mt-1">{card.sub}</p>
              </div>
            );
          })}
        </div>

        {/* Tab switch */}
        <div className="flex items-center justify-between">
          <div className="flex gap-1 bg-gray-100 p-1 rounded-xl w-fit">
            {(['kanban', 'list'] as const).map(tab => (
              <button key={tab} onClick={() => setActiveTab(tab)}
                className={`px-4 py-1.5 rounded-lg text-sm font-medium capitalize transition-all ${activeTab === tab ? 'bg-white shadow-sm text-gray-900' : 'text-gray-500 hover:text-gray-700'}`}>
                {tab === 'kanban' ? 'Kanban' : 'List'}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-2">
            <button onClick={exportPayments} className="btn-secondary flex items-center gap-2 text-sm">
              <Download className="w-4 h-4" /> Export
            </button>
            {canManage && <button className="btn-primary flex items-center gap-2 text-sm" onClick={() => openFeeEditor()}>
              <Plus className="w-4 h-4" /> New Fee
            </button>}
          </div>
        </div>

        {/* Kanban board */}
        {activeTab === 'kanban' ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
            {LANES.map(lane => {
              const Icon = lane.icon;
              const lanePayments = byLane[lane.key] || [];
              const laneTotal = lanePayments.reduce((s, p) => s + p.amount, 0);
              return (
                <div key={lane.key} className={`${lane.bg} rounded-2xl border ${lane.border} p-4`}>
                  {/* Lane header */}
                  <div className="flex items-center justify-between mb-3">
                    <div className="flex items-center gap-2">
                      <Icon className={`w-4 h-4 ${lane.badge.includes('red') ? 'text-red-600' : lane.badge.includes('amber') ? 'text-amber-600' : lane.badge.includes('blue') ? 'text-blue-600' : 'text-green-600'}`} />
                      <span className="text-sm font-semibold text-gray-800">{lane.label}</span>
                    </div>
                    <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${lane.badge}`}>{lanePayments.length}</span>
                  </div>
                  <p className="text-xs text-gray-500 mb-3">{formatCurrency(laneTotal)}</p>

                  {/* Cards */}
                  <div className="space-y-2 max-h-[420px] overflow-y-auto pr-0.5">
                    {lanePayments.length ? lanePayments.map(p => (
                      <PaymentCard key={p.id} payment={p} lane={lane} />
                    )) : (
                      <div className="text-center py-8 text-gray-300 text-sm">No payments</div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          /* List view */
          <div className="card !p-0 overflow-hidden">
            <table className="table">
              <thead>
                <tr>
                  <th>Student</th><th>Fee</th><th>Amount</th>
                  <th>Method</th><th>Status</th><th>Due / Paid</th>
                </tr>
              </thead>
              <tbody>
                {enriched.slice(0, 50).map(p => (
                  <tr key={p.id} className="hover:bg-gray-50/60">
                    <td>
                      <div className="flex items-center gap-2">
                        <div className="w-7 h-7 rounded-full bg-primary-100 text-primary-700 flex items-center justify-center text-xs font-bold flex-shrink-0">
                          {p.student?.user?.name?.[0] || '?'}
                        </div>
                        <div>
                          <p className="text-sm font-medium text-gray-900">{p.student?.user?.name || '—'}</p>
                          <p className="text-xs text-gray-400">{p.student?.admissionNo}</p>
                        </div>
                      </div>
                    </td>
                    <td className="text-sm text-gray-600">{p.fee?.name}</td>
                    <td className="font-semibold text-sm">{formatCurrency(p.amount)}</td>
                    <td>{p.method && <span className="badge badge-gray text-xs">{p.method}</span>}</td>
                    <td>
                      <span className={`badge text-xs ${p.status === 'PAID' ? 'badge-green' : p.status === 'OVERDUE' ? 'badge-red' : p.status === 'PARTIAL' ? 'badge-blue' : 'badge-yellow'}`}>
                        {p.status}
                      </span>
                    </td>
                    <td className="text-xs text-gray-500">{p.fee?.dueDate ? formatDate(p.fee.dueDate) : formatDate(p.createdAt!)}</td>
                  </tr>
                ))}
                {!enriched.length && (
                  <tr><td colSpan={6} className="text-center text-gray-400 py-12">No payments</td></tr>
                )}
              </tbody>
            </table>
          </div>
        )}

        {/* Fee Structures */}
        <div className="card">
          <div className="flex items-center justify-between gap-3 mb-4">
            <div><h3 className="font-semibold text-gray-900">{canManage ? 'Fees Assigned to Students' : 'My Assigned Fees'}</h3><p className="text-xs text-gray-500 mt-1">Track each student’s balance separately from fee structure setup.</p></div>
            {canManage && <button className="btn-primary text-sm" disabled={!fees?.length} onClick={() => { assignFee.reset(); setAssignmentForm({ feeId: '', studentIds: [] }); setAssignmentEditor(true); }}>Assign Fee</button>}
          </div>
          {canManage ? (
            <div className="overflow-x-auto"><table className="table"><thead><tr><th>Student</th><th>Fee</th><th>Assigned</th><th>Paid</th><th>Balance</th><th>Due</th><th>Actions</th></tr></thead><tbody>
              {feeAssignments.map((assignment: any) => <tr key={assignment.id}><td><p className="font-medium text-sm">{assignment.student?.user?.name}</p><p className="text-xs text-gray-400">{assignment.student?.admissionNo}</p></td><td>{assignment.fee?.name}</td><td>{formatCurrency(assignment.amount)}</td><td>{formatCurrency(assignment.amountPaid)}</td><td className="font-semibold">{formatCurrency(Math.max(0, assignment.amount - assignment.amountPaid))}</td><td>{assignment.dueDate ? formatDate(assignment.dueDate) : '—'}</td><td><div className="flex gap-2">{assignment.amount - assignment.amountPaid > 0 && <button className="text-xs text-primary-700 hover:underline" onClick={() => { setPaymentEditor(assignment); setPaymentForm({ amount: String(assignment.amount - assignment.amountPaid), method: 'CASH' }); recordAssignmentPayment.reset(); }}>Record payment</button>}{assignment.amountPaid === 0 && <button aria-label={`Remove ${assignment.fee?.name} from ${assignment.student?.user?.name}`} className="text-xs text-red-600 hover:underline" disabled={removeFeeAssignment.isPending} onClick={() => removeFeeAssignment.mutate(assignment.id)}>Remove</button>}</div></td></tr>)}
              {!feeAssignments.length && <tr><td colSpan={7} className="py-8 text-center text-sm text-gray-400">No fees assigned to students yet.</td></tr>}
            </tbody></table></div>
          ) : <div className="space-y-2">{feeAssignments.map((assignment: any) => { const balance = Math.max(0, assignment.amount - assignment.amountPaid); const overdue = balance > 0 && assignment.dueDate && new Date(assignment.dueDate) < new Date(); return <div key={assignment.id} className="flex items-center justify-between gap-4 rounded-xl border p-3"><div><p className="font-medium text-sm">{assignment.fee?.name}</p><p className="text-xs text-gray-500">{assignment.fee?.academicYear}{assignment.dueDate ? ` · Due ${formatDate(assignment.dueDate)}` : ''}</p></div><div className="text-right"><p className="font-semibold">{formatCurrency(balance)} due</p><p className={`text-xs ${overdue ? 'text-red-600' : 'text-gray-500'}`}>{balance === 0 ? 'Paid' : overdue ? 'Overdue' : `Paid ${formatCurrency(assignment.amountPaid)}`}</p></div></div>; })}{!feeAssignments.length && <p className="py-8 text-center text-sm text-gray-400">No fees have been assigned to your account.</p>}</div>}
          {removeFeeAssignment.isError && <p role="alert" className="mt-2 text-sm text-red-600">Couldn’t remove that assignment. Assignments with recorded payments must be kept for the payment history.</p>}
        </div>

        {/* Fee Structures */}
        <div className="card">
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-semibold text-gray-900">Fee Structures</h3>
            {canManage && <button onClick={() => openFeeEditor()} className="flex items-center gap-1 text-xs text-primary-600 hover:underline">Add fee structure <ArrowRight className="w-3 h-3" /></button>}
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3">
            {(fees || []).map((fee: any) => (
              <div key={fee.id} className="flex items-center gap-3 p-3 rounded-xl border hover:border-primary-200 hover:bg-primary-50/30 transition-all">
                <div className="w-9 h-9 rounded-xl bg-primary-100 flex items-center justify-center flex-shrink-0">
                  <DollarSign className="w-5 h-5 text-primary-600" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-gray-900 truncate">{fee.name}</p>
                  <p className="text-xs text-gray-400">{fee.academicYear}{fee.dueDate ? ` · Due ${formatDate(fee.dueDate)}` : ''}</p>
                </div>
                <p className="text-sm font-bold text-green-700 flex-shrink-0">{formatCurrency(fee.amount)}</p>
                {canManage && <button aria-label={`Edit ${fee.name}`} onClick={() => openFeeEditor(fee)} className="p-1.5 text-gray-400 hover:text-primary-600"><Pencil className="w-4 h-4" /></button>}
              </div>
            ))}
            {!(fees || []).length && <p className="text-sm text-gray-400 col-span-3 py-4 text-center">No fee structures defined</p>}
          </div>
        </div>
      </div>
      {assignmentEditor && <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"><div className="bg-white rounded-2xl shadow-xl w-full max-w-lg p-6"><h2 className="text-lg font-semibold mb-4">Assign fee to students</h2><div className="space-y-3"><label className="label">Fee structure<select className="select mt-1" value={assignmentForm.feeId} onChange={event => setAssignmentForm(form => ({ ...form, feeId: event.target.value }))}><option value="">Choose a fee…</option>{(fees || []).map((fee: any) => <option key={fee.id} value={fee.id}>{fee.name} · {formatCurrency(fee.amount)} · {fee.academicYear}</option>)}</select></label><label className="label">Students<select multiple size={6} className="select mt-1" value={assignmentForm.studentIds} onChange={event => setAssignmentForm(form => ({ ...form, studentIds: Array.from(event.target.selectedOptions, option => option.value) }))}>{students.map((student: any) => <option key={student.id} value={student.id}>{student.user?.name} · {student.admissionNo}{student.class?.name ? ` · ${student.class.name}` : ''}</option>)}</select><span className="block text-xs text-gray-500 mt-1">Use Ctrl or Command to select more than one student.</span></label>{assignFee.isError && <p role="alert" className="text-sm text-red-600">Couldn’t assign this fee. Check the selection; an existing assignment will be kept and not duplicated.</p>}</div><div className="flex gap-3 mt-5"><button className="btn-secondary flex-1" onClick={() => setAssignmentEditor(false)}>Cancel</button><button className="btn-primary flex-1" disabled={!assignmentForm.feeId || !assignmentForm.studentIds.length || assignFee.isPending} onClick={() => assignFee.mutate()}>{assignFee.isPending ? 'Assigning…' : `Assign to ${assignmentForm.studentIds.length || 0} student${assignmentForm.studentIds.length === 1 ? '' : 's'}`}</button></div></div></div>}
      {paymentEditor && <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"><div className="bg-white rounded-2xl shadow-xl w-full max-w-md p-6"><h2 className="text-lg font-semibold">Record fee payment</h2><p className="text-sm text-gray-500 mt-1">{paymentEditor.student?.user?.name} · {paymentEditor.fee?.name}</p><p className="text-xs text-gray-500 mt-1">Remaining balance: {formatCurrency(paymentEditor.amount - paymentEditor.amountPaid)}</p><div className="space-y-3 mt-4"><label className="label">Amount received<input className="input mt-1" type="number" min="0.01" max={paymentEditor.amount - paymentEditor.amountPaid} step="0.01" value={paymentForm.amount} onChange={event => setPaymentForm(form => ({ ...form, amount: event.target.value }))} /></label><label className="label">Method<select className="select mt-1" value={paymentForm.method} onChange={event => setPaymentForm(form => ({ ...form, method: event.target.value }))}><option value="CASH">Cash</option><option value="BANK_TRANSFER">Bank transfer</option><option value="MOBILE_MONEY">Mobile money</option></select></label>{recordAssignmentPayment.isError && <p role="alert" className="text-sm text-red-600">Couldn’t record that payment. The amount must be positive and no greater than the remaining balance.</p>}</div><div className="flex gap-3 mt-5"><button className="btn-secondary flex-1" onClick={() => setPaymentEditor(null)}>Cancel</button><button className="btn-primary flex-1" disabled={!Number(paymentForm.amount) || Number(paymentForm.amount) <= 0 || Number(paymentForm.amount) > paymentEditor.amount - paymentEditor.amountPaid || recordAssignmentPayment.isPending} onClick={() => recordAssignmentPayment.mutate()}>{recordAssignmentPayment.isPending ? 'Saving…' : 'Record payment'}</button></div></div></div>}
      {feeEditor && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md p-6">
            <h2 className="text-lg font-semibold mb-4">{feeEditor.id ? 'Edit Fee Structure' : 'New Fee Structure'}</h2>
            <div className="space-y-3">
              <label className="label">Fee name<input className="input mt-1" value={feeForm.name} onChange={e => setFeeForm(f => ({ ...f, name: e.target.value }))} /></label>
              <div className="grid grid-cols-2 gap-3"><label className="label">Amount<input className="input mt-1" type="number" min="0.01" step="0.01" value={feeForm.amount} onChange={e => setFeeForm(f => ({ ...f, amount: e.target.value }))} /></label><label className="label">Academic year<input className="input mt-1" value={feeForm.academicYear} onChange={e => setFeeForm(f => ({ ...f, academicYear: e.target.value }))} /></label></div>
              <label className="label">Due date (optional)<input className="input mt-1" type="datetime-local" value={feeForm.dueDate} onChange={e => setFeeForm(f => ({ ...f, dueDate: e.target.value }))} /></label>
              <label className="label">Description<textarea className="input mt-1" rows={3} value={feeForm.description} onChange={e => setFeeForm(f => ({ ...f, description: e.target.value }))} /></label>
              {saveFee.isError && <p role="alert" className="text-sm text-red-600">Couldn’t save the fee structure. Please check the fields and try again.</p>}
            </div>
            <div className="flex gap-3 mt-5"><button className="btn-secondary flex-1" onClick={() => setFeeEditor(null)}>Cancel</button><button className="btn-primary flex-1" disabled={!feeForm.name.trim() || !feeForm.amount || !feeForm.academicYear.trim() || saveFee.isPending} onClick={() => saveFee.mutate()}>{saveFee.isPending ? 'Saving…' : 'Save Fee'}</button></div>
          </div>
        </div>
      )}
    </DashboardLayout>
  );
}
