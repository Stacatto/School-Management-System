'use client';

import { useEffect, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { DashboardLayout } from '@/components/layout/DashboardLayout';
import { api, examsAPI } from '@/lib/api';
import { Plus, ClipboardList, Pencil } from 'lucide-react';
import { formatDate } from '@/lib/utils';
import { useAuthStore } from '@/store/authStore';
import toast from 'react-hot-toast';

const EMPTY_FORM = {
  title: '',
  description: '',
  subjectId: '',
  classId: '',
  examDate: '',
  duration: '60',
  totalMarks: '100',
  passMark: '50',
};

function toLocalDateTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
}

export default function ExamsPage() {
  const [page, setPage] = useState(1);
  const [showCreate, setShowCreate] = useState(false);
  const [editingExam, setEditingExam] = useState<any | null>(null);
  const [resultsExam, setResultsExam] = useState<any | null>(null);
  const [resultValues, setResultValues] = useState<Record<string, { score: string; grade: string; remarks: string }>>({});
  const [form, setForm] = useState(EMPTY_FORM);
  const qc = useQueryClient();
  const { user } = useAuthStore();
  const canCreate = user?.role === 'ADMIN' || user?.role === 'TEACHER';

  const { data, isLoading } = useQuery({
    queryKey: ['exams', page],
    queryFn: () => examsAPI.list({ page, limit: 20 }).then(r => r.data),
  });

  const { data: classes = [] } = useQuery({
    queryKey: ['classes'],
    queryFn: () => api.get('/classes').then(r => r.data.data),
    enabled: showCreate && canCreate,
  });

  const resultsQuery = useQuery({
    queryKey: ['exam-results-entry', resultsExam?.id],
    queryFn: async () => {
      const [studentsResponse, resultsResponse] = await Promise.all([
        api.get(`/classes/${resultsExam.classId}/students`),
        api.get(`/exams/${resultsExam.id}/results`),
      ]);
      return { students: studentsResponse.data.data, results: resultsResponse.data.data };
    },
    enabled: !!resultsExam,
  });

  useEffect(() => {
    if (!resultsExam || !resultsQuery.data) return;
    const existing = new Map(resultsQuery.data.results.map((result: any) => [result.studentId, result]));
    setResultValues(Object.fromEntries(resultsQuery.data.students.map((student: any) => {
      const result: any = existing.get(student.id);
      return [student.id, { score: result ? String(result.score) : '', grade: result?.grade || '', remarks: result?.remarks || '' }];
    })));
  }, [resultsExam, resultsQuery.data]);

  const saveResults = useMutation({
    mutationFn: () => api.post(`/exams/${resultsExam.id}/results`, {
      results: Object.entries(resultValues).filter(([, value]) => value.score !== '').map(([studentId, value]) => ({ studentId, score: Number(value.score), grade: value.grade || null, remarks: value.remarks || null })),
    }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['exam-results-entry', resultsExam?.id] }); qc.invalidateQueries({ queryKey: ['exams'] }); setResultsExam(null); toast.success('Exam results saved'); },
    onError: (error: any) => toast.error(error?.response?.data?.message || 'Could not save exam results.'),
  });

  const saveExam = useMutation({
    mutationFn: () => {
      const payload = {
        ...form,
        examDate: new Date(form.examDate).toISOString(),
        duration: Number(form.duration),
        totalMarks: Number(form.totalMarks),
        passMark: Number(form.passMark),
      };
      return editingExam
        ? api.put('/exams/' + editingExam.id, payload)
        : examsAPI.create(payload);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['exams'] });
      setForm(EMPTY_FORM);
      setShowCreate(false);
      toast.success(editingExam ? 'Exam updated' : 'Exam created');
      setEditingExam(null);
    },
    onError: (error: any) => toast.error(error?.response?.data?.message || 'Could not save the exam. Check the details and try again.'),
  });

  const exams = data?.data || [];
  const pagination = data?.pagination;

  return (
    <>
      <DashboardLayout title="Exams & Grading" allowedRoles={['ADMIN', 'TEACHER', 'STUDENT']}>
        <div className="space-y-5">
          <div className="flex justify-between items-center">
            <p className="text-sm text-gray-500">{pagination?.total || 0} exams total</p>
            {canCreate && (
              <button className="btn-primary flex items-center gap-2" onClick={() => { setEditingExam(null); setForm(EMPTY_FORM); saveExam.reset(); setShowCreate(true); }}>
                <Plus className="w-4 h-4" />
                Create Exam
              </button>
            )}
          </div>

          {isLoading ? (
            <div className="flex justify-center py-20">
              <div className="w-8 h-8 border-4 border-primary-600 border-t-transparent rounded-full animate-spin" />
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
              {exams.map((exam: any) => {
                const isPast = new Date(exam.examDate) < new Date();
                return (
                  <div key={exam.id} className="card hover:shadow-md transition-shadow">
                    <div className="flex items-start justify-between mb-3">
                      <div className="w-10 h-10 bg-primary-100 rounded-xl flex items-center justify-center">
                        <ClipboardList className="w-5 h-5 text-primary-600" />
                      </div>
                      <div className="flex items-center gap-2">
                        <span className={`badge ${isPast ? 'badge-gray' : 'badge-green'}`}>
                          {isPast ? 'Completed' : 'Upcoming'}
                        </span>
                        {canCreate && (
                          <div className="flex items-center gap-2">
                          <button type="button" className="btn-secondary !px-2.5 !py-1.5 text-xs" onClick={() => { setResultsExam(exam); setResultValues({}); saveResults.reset(); }}>Enter Results</button>
                          <button
                            type="button"
                            className="btn-secondary !px-2.5 !py-1.5 text-xs flex items-center gap-1"
                            aria-label={'Edit ' + exam.title}
                            onClick={() => {
                              setEditingExam(exam);
                              setForm({
                                title: exam.title || '',
                                description: exam.description || '',
                                subjectId: exam.subjectId || '',
                                classId: exam.classId || '',
                                examDate: toLocalDateTime(exam.examDate),
                                duration: String(exam.duration ?? 60),
                                totalMarks: String(exam.totalMarks ?? 100),
                                passMark: String(exam.passMark ?? 50),
                              });
                              saveExam.reset();
                              setShowCreate(true);
                            }}
                          >
                            <Pencil className="w-3.5 h-3.5" /> Edit
                          </button>
                          </div>
                        )}
                      </div>
                    </div>
                    <h3 className="font-semibold text-gray-900">{exam.title}</h3>
                    <p className="text-sm text-gray-500 mt-1">{exam.subject?.name} • {exam.class?.name}</p>
                    <div className="mt-4 pt-3 border-t flex items-center justify-between text-sm text-gray-500">
                      <span>{formatDate(exam.examDate)}</span>
                      <span>{exam.duration} min • {exam.totalMarks} marks</span>
                    </div>
                  </div>
                );
              })}
              {!exams.length && (
                <div className="col-span-3 text-center py-12 text-gray-400">No exams scheduled</div>
              )}
            </div>
          )}
        </div>
      </DashboardLayout>

      {showCreate && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg p-6 animate-scale-in max-h-[90vh] overflow-y-auto">
            <h2 className="text-lg font-semibold text-gray-900 mb-4">{editingExam ? 'Edit Exam' : 'Create Exam'}</h2>
            <div className="space-y-4">
              <div>
                <label className="label">Exam Title</label>
                <input className="input" placeholder="e.g. Grade 7 Mathematics Test" value={form.title} onChange={e => setForm(v => ({ ...v, title: e.target.value }))} />
              </div>
              <div>
                <label className="label">Description (optional)</label>
                <textarea className="input resize-none" rows={2} placeholder="Notes about this exam" value={form.description} onChange={e => setForm(v => ({ ...v, description: e.target.value }))} />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="label">Subject</label>
                  <select className="select" disabled={!form.classId || !(classes.find((item: any) => item.id === form.classId)?.subjects || []).length} value={form.subjectId} onChange={e => setForm(v => ({ ...v, subjectId: e.target.value }))}>
                    <option value="">Select…</option>
                    {(classes.find((item: any) => item.id === form.classId)?.subjects || []).map((subject: any) => <option key={subject.id} value={subject.id}>{subject.name}</option>)}
                  </select>
                </div>
                <div>
                  <label className="label">Class</label>
                  <select className="select" value={form.classId} onChange={e => setForm(v => ({ ...v, classId: e.target.value, subjectId: '' }))}>
                    <option value="">Select…</option>
                    {(classes || []).map((cls: any) => <option key={cls.id} value={cls.id}>{cls.name}</option>)}
                  </select>
                </div>
              </div>
              {form.classId && !(classes.find((item: any) => item.id === form.classId)?.subjects || []).length && <p className="text-xs text-amber-700">Add subjects to this class in Classes before scheduling exams.</p>}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="label">Exam Date and Time</label>
                  <input className="input" type="datetime-local" value={form.examDate} onChange={e => setForm(v => ({ ...v, examDate: e.target.value }))} />
                </div>
                <div>
                  <label className="label">Duration (minutes)</label>
                  <input className="input" type="number" min="1" value={form.duration} onChange={e => setForm(v => ({ ...v, duration: e.target.value }))} />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="label">Total Marks</label>
                  <input className="input" type="number" min="1" value={form.totalMarks} onChange={e => setForm(v => ({ ...v, totalMarks: e.target.value }))} />
                </div>
                <div>
                  <label className="label">Pass Mark</label>
                  <input className="input" type="number" min="0" value={form.passMark} onChange={e => setForm(v => ({ ...v, passMark: e.target.value }))} />
                </div>
              </div>
            </div>
            <div className="flex gap-3 mt-6">
              <button className="btn-secondary flex-1" onClick={() => { setShowCreate(false); setForm(EMPTY_FORM); setEditingExam(null); saveExam.reset(); }}>Cancel</button>
              <button
                className="btn-primary flex-1"
                disabled={!form.title.trim() || !form.subjectId || !form.classId || !form.examDate || Number(form.duration) < 1 || Number(form.totalMarks) < 1 || Number(form.passMark) < 0 || saveExam.isPending}
                onClick={() => saveExam.mutate()}
              >
                {saveExam.isPending ? 'Saving…' : editingExam ? 'Save Changes' : 'Create Exam'}
              </button>
            </div>
          </div>
        </div>
      )}
      {resultsExam && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-2xl p-6 max-h-[90vh] overflow-y-auto">
            <h2 className="text-lg font-semibold text-gray-900">Enter results · {resultsExam.title}</h2>
            <p className="text-sm text-gray-500 mt-1 mb-4">Enter each student’s score, grade, and optional remarks. Scores are out of {resultsExam.totalMarks}.</p>
            {resultsQuery.isLoading ? <div className="py-10 text-center text-gray-500">Loading class roster…</div> : resultsQuery.isError ? <p role="alert" className="text-sm text-red-600">Couldn’t load the class roster or existing results.</p> : (
              <div className="space-y-3">
                {(resultsQuery.data?.students || []).map((student: any) => {
                  const previous = resultsQuery.data?.results?.find((result: any) => result.studentId === student.id);
                  const value = resultValues[student.id] || { score: previous ? String(previous.score) : '', grade: previous?.grade || '', remarks: previous?.remarks || '' };
                  return <div key={student.id} className="grid grid-cols-1 sm:grid-cols-[1fr_100px_100px_1fr] gap-2 items-center border rounded-xl p-3">
                    <div><p className="text-sm font-medium">{student.user?.name || 'Student'}</p><p className="text-xs text-gray-500">{student.admissionNo}</p></div>
                    <input aria-label={`${student.user?.name} score`} className="input" type="number" min="0" max={resultsExam.totalMarks} placeholder={`/${resultsExam.totalMarks}`} value={value.score} onChange={e => setResultValues(v => ({ ...v, [student.id]: { ...value, score: e.target.value } }))} />
                    <input aria-label={`${student.user?.name} grade`} className="input" placeholder="Grade" value={value.grade} onChange={e => setResultValues(v => ({ ...v, [student.id]: { ...value, grade: e.target.value } }))} />
                    <input aria-label={`${student.user?.name} remarks`} className="input" placeholder="Remarks" value={value.remarks} onChange={e => setResultValues(v => ({ ...v, [student.id]: { ...value, remarks: e.target.value } }))} />
                  </div>;
                })}
                {!resultsQuery.data?.students?.length && <p className="py-6 text-center text-gray-500">No students are enrolled in this class yet.</p>}
              </div>
            )}
            <div className="flex gap-3 mt-5"><button className="btn-secondary flex-1" onClick={() => setResultsExam(null)}>Cancel</button><button className="btn-primary flex-1" disabled={resultsQuery.isLoading || !Object.values(resultValues).some(value => value.score !== '') || saveResults.isPending} onClick={() => saveResults.mutate()}>{saveResults.isPending ? 'Saving…' : 'Save Results'}</button></div>
          </div>
        </div>
      )}
    </>
  );
}
