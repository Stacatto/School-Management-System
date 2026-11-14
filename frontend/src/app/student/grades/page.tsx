'use client';

import { useQuery } from '@tanstack/react-query';
import { Award, BookOpen, CalendarDays } from 'lucide-react';
import { DashboardLayout } from '@/components/layout/DashboardLayout';
import { api } from '@/lib/api';
import { formatDate } from '@/lib/utils';
import { useAuthStore } from '@/store/authStore';

export default function StudentGradesPage() {
  const { user } = useAuthStore();
  const { data: results = [], isLoading, isError, refetch } = useQuery({
    queryKey: ['my-grades', user?.id],
    queryFn: () => api.get('/exams/my-results').then(response => response.data.data),
    enabled: !!user?.id,
  });

  return (
    <DashboardLayout title="My Results" subtitle="Your recorded exam scores" allowedRoles={['STUDENT']}>
      <div className="space-y-5">
        {isLoading ? (
          <div className="card py-12 text-center text-sm text-gray-500">Loading your results…</div>
        ) : isError ? (
          <div className="card py-10 text-center">
            <p role="alert" className="text-sm text-red-600">We couldn’t load your results.</p>
            <button className="btn-secondary mt-4" onClick={() => refetch()}>Try again</button>
          </div>
        ) : results.length ? (
          <>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div className="card flex items-center gap-3">
                <div className="rounded-xl bg-violet-50 p-3"><Award className="w-5 h-5 text-violet-600" /></div>
                <div><p className="text-xs text-gray-500">Exams recorded</p><p className="text-xl font-bold text-gray-900">{results.length}</p></div>
              </div>
              <div className="card flex items-center gap-3">
                <div className="rounded-xl bg-blue-50 p-3"><BookOpen className="w-5 h-5 text-blue-600" /></div>
                <div><p className="text-xs text-gray-500">Subjects</p><p className="text-xl font-bold text-gray-900">{new Set(results.map((result: any) => result.exam?.subject?.id).filter(Boolean)).size}</p></div>
              </div>
              <div className="card flex items-center gap-3">
                <div className="rounded-xl bg-emerald-50 p-3"><Award className="w-5 h-5 text-emerald-600" /></div>
                <div>
                  <p className="text-xs text-gray-500">Average score</p>
                  <p className="text-xl font-bold text-gray-900">{(results.reduce((sum: number, result: any) => sum + Number(result.percentage ?? 0), 0) / results.length).toFixed(1)}%</p>
                </div>
              </div>
            </div>
            <div className="card overflow-hidden !p-0">
              <div className="hidden md:grid grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)] gap-4 border-b bg-gray-50 px-5 py-3 text-xs font-semibold uppercase tracking-wide text-gray-500">
                <span>Exam</span><span>Score</span><span>Grade</span><span>Date</span>
              </div>
              <div className="divide-y">
                {results.map((result: any) => {
                  const total = Number(result.exam?.totalMarks || 0);
                  const score = Number(result.score || 0);
                  const percentage = Number(result.percentage ?? (total ? score / total * 100 : 0));
                  return (
                    <article key={result.id} className="grid grid-cols-1 md:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)] gap-2 md:gap-4 px-5 py-4 items-center">
                      <div>
                        <p className="font-semibold text-gray-900">{result.exam?.title || 'Exam result'}</p>
                        <p className="text-sm text-gray-500">{result.exam?.subject?.name || 'Subject not listed'}</p>
                        {result.remarks && <p className="mt-1 text-xs text-gray-500">{result.remarks}</p>}
                      </div>
                      <div><span className="md:hidden text-xs text-gray-400">Score · </span><span className="font-semibold text-gray-900">{score} / {total}</span><span className="ml-2 text-xs text-gray-500">({percentage.toFixed(1)}%)</span></div>
                      <div><span className="md:hidden text-xs text-gray-400">Grade · </span><span className="font-medium text-gray-700">{result.grade || '—'}</span></div>
                      <div className="text-sm text-gray-500 flex items-center gap-1.5"><CalendarDays className="w-3.5 h-3.5" />{result.exam?.examDate ? formatDate(result.exam.examDate) : '—'}</div>
                    </article>
                  );
                })}
              </div>
            </div>
          </>
        ) : (
          <div className="card py-12 text-center">
            <Award className="mx-auto h-10 w-10 text-gray-300" />
            <h2 className="mt-3 font-semibold text-gray-800">No results recorded yet</h2>
            <p className="mt-1 text-sm text-gray-500">When your teacher or administrator records an exam score, it will appear here.</p>
          </div>
        )}
      </div>
    </DashboardLayout>
  );
}
