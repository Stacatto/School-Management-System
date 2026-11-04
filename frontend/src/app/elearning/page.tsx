'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { DashboardLayout } from '@/components/layout/DashboardLayout';
import { api } from '@/lib/api';
import { useState } from 'react';
import { BookOpen, PlayCircle, FileText, Clock, CheckCircle, Lock, ChevronRight, Star, Plus, Pencil, X } from 'lucide-react';
import { useAuthStore } from '@/store/authStore';

interface Course {
  id: string;
  title: string;
  subjectId?: string | null;
  status?: string;
  description?: string;
  subject?: { name: string };
  teacher?: { name: string };
  thumbnail?: string;
  duration?: number;
  lessonCount?: number;
  enrolledCount?: number;
  progress?: number;
  isEnrolled?: boolean;
  rating?: number;
  level?: 'BEGINNER' | 'INTERMEDIATE' | 'ADVANCED';
}

const LEVEL_MAP = {
  BEGINNER: { cls: 'badge-green', label: 'Beginner' },
  INTERMEDIATE: { cls: 'badge-yellow', label: 'Intermediate' },
  ADVANCED: { cls: 'badge-red', label: 'Advanced' },
};

const SUBJECT_COLORS = ['from-blue-400 to-blue-600', 'from-violet-400 to-violet-600', 'from-green-400 to-green-600', 'from-orange-400 to-orange-600', 'from-rose-400 to-rose-600', 'from-teal-400 to-teal-600'];

function CourseCard({ course, onEnroll, onContinue, onEdit, canEdit }: { course: Course; onEnroll: () => void; onContinue: () => void; onEdit: () => void; canEdit: boolean }) {
  const colorIdx = (course.title.charCodeAt(0) || 0) % SUBJECT_COLORS.length;
  const gradient = SUBJECT_COLORS[colorIdx];
  const level = LEVEL_MAP[course.level || 'BEGINNER'];

  return (
    <div className="card-hover overflow-hidden p-0">
      {/* Thumbnail */}
      <div className={`w-full h-32 bg-gradient-to-br ${gradient} flex items-center justify-center relative`}>
        <BookOpen className="w-10 h-10 text-white/80" />
        {course.isEnrolled && course.progress !== undefined && (
          <div className="absolute bottom-0 left-0 right-0 h-1 bg-black/20">
            <div className="h-full bg-white transition-all" style={{ width: `${course.progress}%` }} />
          </div>
        )}
        {course.isEnrolled && (
          <div className="absolute top-2 right-2 bg-white/20 backdrop-blur-sm rounded-full px-2 py-0.5 text-white text-xs font-medium">
            {course.progress ?? 0}%
          </div>
        )}
      </div>

      <div className="p-4">
        <div className="flex items-start justify-between gap-2 mb-1">
          <h3 className="font-semibold text-gray-900 text-sm line-clamp-2">{course.title}</h3>
          <div className="flex items-center gap-1">{course.status && course.status !== 'PUBLISHED' && <span className="badge badge-yellow">Draft</span>}<span className={`badge ${level.cls} flex-shrink-0`}>{level.label}</span>{canEdit && <button aria-label={`Edit ${course.title}`} onClick={onEdit} className="p-1 text-gray-400 hover:text-primary-600"><Pencil className="w-4 h-4" /></button>}</div>
        </div>

        {course.description && (
          <p className="text-xs text-gray-500 line-clamp-2 mb-2">{course.description}</p>
        )}

        <div className="flex items-center gap-3 text-xs text-gray-400 mb-3">
          {course.lessonCount !== undefined && (
            <span className="flex items-center gap-1"><PlayCircle className="w-3 h-3" />{course.lessonCount} lessons</span>
          )}
          {course.duration !== undefined && (
            <span className="flex items-center gap-1"><Clock className="w-3 h-3" />{course.duration}h</span>
          )}
          {course.rating !== undefined && (
            <span className="flex items-center gap-1 ml-auto"><Star className="w-3 h-3 fill-yellow-400 text-yellow-400" />{course.rating.toFixed(1)}</span>
          )}
        </div>

        {course.teacher && (
          <p className="text-xs text-gray-400 mb-3">By {course.teacher.name}</p>
        )}

        <button onClick={canEdit || course.isEnrolled ? onContinue : onEnroll} className={`w-full text-sm font-medium py-2 rounded-xl transition-all ${canEdit || course.isEnrolled ? 'bg-primary-50 text-primary-700 hover:bg-primary-100' : 'bg-primary-600 text-white hover:bg-primary-700'}`}>
          {canEdit ? 'Manage Lessons' : course.isEnrolled ? (
            <span className="flex items-center justify-center gap-2">
              <PlayCircle className="w-3.5 h-3.5" /> Continue
            </span>
          ) : 'Enroll Now'}
        </button>
      </div>
    </div>
  );
}

export default function ELearningPage() {
  const { user } = useAuthStore();
  const qc = useQueryClient();
  const canManage = user?.role === 'ADMIN' || user?.role === 'TEACHER';
  const [tab, setTab] = useState<'all' | 'enrolled' | 'completed'>('all');
  const [search, setSearch] = useState('');
  const [editing, setEditing] = useState<Course | null>(null);
  const [showEditor, setShowEditor] = useState(false);
  const [selectedCourse, setSelectedCourse] = useState<string | null>(null);
  const [courseForm, setCourseForm] = useState({ title: '', description: '', thumbnail: '', subjectId: '', status: 'DRAFT' });
  const [lessonEditorOpen, setLessonEditorOpen] = useState(false);
  const [editingLesson, setEditingLesson] = useState<any>(null);
  const [lessonForm, setLessonForm] = useState({ title: '', content: '', videoUrl: '', duration: '' });

  const { data, isLoading } = useQuery({
    queryKey: ['courses'],
    queryFn: () => api.get('/elearning/courses').then(r => r.data.data),
  });

  const { data: enrollments = [] } = useQuery({ queryKey: ['my-courses'], queryFn: () => api.get('/elearning/my-courses').then(r => r.data.data), enabled: user?.role === 'STUDENT' });
  const { data: subjects = [] } = useQuery({ queryKey: ['subjects'], queryFn: () => api.get('/subjects').then(r => r.data.data), enabled: canManage });
  const enrolledIds = new Set((enrollments as any[]).map(e => e.courseId));
  const saveCourse = useMutation({ mutationFn: () => editing ? api.put(`/elearning/courses/${editing.id}`, courseForm) : api.post('/elearning/courses', courseForm), onSuccess: () => { qc.invalidateQueries({ queryKey: ['courses'] }); setShowEditor(false); setEditing(null); } });
  const enroll = useMutation({ mutationFn: (id: string) => api.post(`/elearning/courses/${id}/enroll`), onSuccess: () => { qc.invalidateQueries({ queryKey: ['my-courses'] }); qc.invalidateQueries({ queryKey: ['courses'] }); } });
  const openEditor = (course?: Course) => { setEditing(course || null); setCourseForm(course ? { title: course.title, description: course.description || '', thumbnail: course.thumbnail || '', subjectId: course.subjectId || '', status: course.status || 'DRAFT' } : { title: '', description: '', thumbnail: '', subjectId: '', status: 'DRAFT' }); saveCourse.reset(); setShowEditor(true); };
  const { data: courseDetail } = useQuery({ queryKey: ['course-detail', selectedCourse], queryFn: () => api.get(`/elearning/courses/${selectedCourse}`).then(r => r.data.data), enabled: !!selectedCourse });
  const { data: courseProgress } = useQuery({ queryKey: ['course-progress', selectedCourse], queryFn: () => api.get(`/elearning/courses/${selectedCourse}/progress`).then(r => r.data.data), enabled: !!selectedCourse && user?.role === 'STUDENT' });
  const completeLesson = useMutation({ mutationFn: (lessonId: string) => api.post(`/elearning/lessons/${lessonId}/complete`), onSuccess: () => qc.invalidateQueries({ queryKey: ['course-progress', selectedCourse] }) });
  const saveLesson = useMutation({ mutationFn: () => editingLesson ? api.put(`/elearning/lessons/${editingLesson.id}`, { ...lessonForm, duration: lessonForm.duration ? Number(lessonForm.duration) : null }) : api.post(`/elearning/courses/${selectedCourse}/lessons`, { ...lessonForm, duration: lessonForm.duration ? Number(lessonForm.duration) : null }), onSuccess: () => { qc.invalidateQueries({ queryKey: ['course-detail', selectedCourse] }); setLessonEditorOpen(false); setEditingLesson(null); } });
  const openLessonEditor = (lesson?: any) => { setEditingLesson(lesson || null); setLessonForm(lesson ? { title: lesson.title, content: lesson.content || '', videoUrl: lesson.videoUrl || '', duration: lesson.duration ? String(lesson.duration) : '' } : { title: '', content: '', videoUrl: '', duration: '' }); saveLesson.reset(); setLessonEditorOpen(true); };

  const courses: Course[] = (data || []).filter((c: Course) => {
    const matchesSearch = !search || c.title.toLowerCase().includes(search.toLowerCase());
    if (tab === 'enrolled') return matchesSearch && c.isEnrolled && (c.progress ?? 0) < 100;
    if (tab === 'completed') return matchesSearch && (c.progress ?? 0) >= 100;
    return matchesSearch;
  });

  const enrolledCount = (data || []).filter((c: Course) => c.isEnrolled).length;
  const completedCount = (data || []).filter((c: Course) => (c.progress ?? 0) >= 100).length;
  const avgProgress = enrolledCount
    ? Math.round((data || []).filter((c: Course) => c.isEnrolled).reduce((s: number, c: Course) => s + (c.progress ?? 0), 0) / enrolledCount)
    : 0;

  return (
    <DashboardLayout
      title="E-Learning"
      subtitle="Learn at your own pace"
      allowedRoles={['ADMIN', 'TEACHER', 'STUDENT']}
      actions={canManage ? <button className="btn-primary" onClick={() => openEditor()}><Plus className="w-4 h-4" /> New Course</button> : undefined}
    >
      <div className="space-y-6">
        {/* Stats strip */}
        <div className="grid grid-cols-3 gap-4">
          {[
            { label: 'Total Courses', value: (data || []).length, icon: BookOpen, color: 'text-primary-600', bg: 'bg-primary-50' },
            { label: 'Enrolled', value: enrolledCount, icon: PlayCircle, color: 'text-blue-600', bg: 'bg-blue-50' },
            { label: 'Avg Progress', value: `${avgProgress}%`, icon: CheckCircle, color: 'text-green-600', bg: 'bg-green-50' },
          ].map(s => (
            <div key={s.label} className="stat-card">
              <div className={`stat-icon ${s.bg}`}><s.icon className={`w-5 h-5 ${s.color}`} /></div>
              <div>
                <p className="text-xl font-bold text-gray-900">{s.value}</p>
                <p className="text-sm text-gray-500">{s.label}</p>
              </div>
            </div>
          ))}
        </div>

        {/* Search + tabs */}
        <div className="flex items-center gap-4 flex-wrap">
          <input className="input max-w-sm" placeholder="Search courses…" value={search} onChange={e => setSearch(e.target.value)} />
          <div className="flex items-center gap-1 bg-slate-100 p-1 rounded-xl">
            {(['all', 'enrolled', 'completed'] as const).map(t => (
              <button
                key={t}
                onClick={() => setTab(t)}
                className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-all ${tab === t ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}
              >
                {t.charAt(0).toUpperCase() + t.slice(1)}
              </button>
            ))}
          </div>
        </div>

        {isLoading ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
            {[...Array(6)].map((_, i) => <div key={i} className="skeleton h-64 rounded-2xl" />)}
          </div>
        ) : courses.length === 0 ? (
          <div className="empty-state">
            <div className="empty-state-icon"><BookOpen className="w-6 h-6 text-gray-400" /></div>
            <p className="empty-state-title">No courses found</p>
            <p className="empty-state-desc">{tab === 'enrolled' ? "You haven't enrolled in any courses yet." : "No courses match your search."}</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
            {courses.map(course => <CourseCard key={course.id} course={{ ...course, isEnrolled: enrolledIds.has(course.id) }} canEdit={canManage} onEdit={() => openEditor(course)} onEnroll={() => enroll.mutate(course.id)} onContinue={() => setSelectedCourse(course.id)} />)}
          </div>
        )}
      </div>
      {showEditor && <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"><div className="bg-white rounded-2xl shadow-xl w-full max-w-lg p-6"><h2 className="text-lg font-semibold mb-4">{editing ? 'Edit Course' : 'New Course'}</h2><div className="space-y-3"><label className="label">Title<input className="input mt-1" value={courseForm.title} onChange={e => setCourseForm(f => ({ ...f, title: e.target.value }))} /></label><label className="label">Description<textarea className="input mt-1" rows={3} value={courseForm.description} onChange={e => setCourseForm(f => ({ ...f, description: e.target.value }))} /></label><label className="label">Thumbnail URL (optional)<input className="input mt-1" value={courseForm.thumbnail} onChange={e => setCourseForm(f => ({ ...f, thumbnail: e.target.value }))} /></label><div className="grid grid-cols-2 gap-3"><label className="label">Subject<select className="select mt-1" value={courseForm.subjectId} onChange={e => setCourseForm(f => ({ ...f, subjectId: e.target.value }))}><option value="">No subject</option>{subjects.map((s: any) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></label><label className="label">Status<select className="select mt-1" value={courseForm.status} onChange={e => setCourseForm(f => ({ ...f, status: e.target.value }))}><option value="DRAFT">Draft</option><option value="PUBLISHED">Published</option></select></label></div>{saveCourse.isError && <p role="alert" className="text-sm text-red-600">Couldn’t save the course. Check the details and try again.</p>}</div><div className="flex gap-3 mt-5"><button className="btn-secondary flex-1" onClick={() => setShowEditor(false)}>Cancel</button><button className="btn-primary flex-1" disabled={!courseForm.title.trim() || saveCourse.isPending} onClick={() => saveCourse.mutate()}>{saveCourse.isPending ? 'Saving…' : 'Save Course'}</button></div></div></div>}
      {selectedCourse && <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"><div className="bg-white rounded-2xl shadow-xl w-full max-w-2xl max-h-[90vh] overflow-y-auto p-6"><div className="flex items-center justify-between mb-4"><h2 className="text-lg font-semibold">{courseDetail?.title || 'Course'}</h2><div className="flex items-center gap-2">{canManage && <button className="btn-primary text-sm" onClick={() => openLessonEditor()}><Plus className="w-4 h-4" /> Add Lesson</button>}<button aria-label="Close course" onClick={() => setSelectedCourse(null)} className="p-2 text-gray-500"><X className="w-5 h-5" /></button></div></div>{courseProgress && <p className="text-sm text-gray-500 mb-4">Progress: {courseProgress.percentage}%</p>}<div className="space-y-3">{(courseDetail?.lessons || []).map((lesson: any, index: number) => <div key={lesson.id} className="border rounded-xl p-4"><div className="flex items-center justify-between gap-3"><div><p className="text-sm font-semibold">{index + 1}. {lesson.title}</p><p className="text-sm text-gray-600 mt-1 whitespace-pre-wrap">{lesson.content}</p>{lesson.videoUrl && <a className="text-sm text-primary-600 underline" href={lesson.videoUrl} target="_blank" rel="noreferrer">Open lesson video</a>}</div><div className="flex gap-2">{canManage && <button className="btn-secondary text-xs" onClick={() => openLessonEditor(lesson)}><Pencil className="w-3 h-3" /> Edit</button>}{user?.role === 'STUDENT' && <button className="btn-secondary text-xs" onClick={() => completeLesson.mutate(lesson.id)}>{completeLesson.isPending ? 'Saving…' : 'Mark complete'}</button>}</div></div></div>)}{courseDetail && !courseDetail.lessons?.length && <p className="text-sm text-gray-500">No lessons have been added to this course yet.</p>}</div></div></div>}
      {lessonEditorOpen && <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 p-4"><div className="bg-white rounded-2xl shadow-xl w-full max-w-lg p-6"><h3 className="text-lg font-semibold mb-4">{editingLesson ? 'Edit Lesson' : 'Add Lesson'}</h3><div className="space-y-3"><label className="label">Title<input className="input mt-1" value={lessonForm.title} onChange={e => setLessonForm(f => ({ ...f, title: e.target.value }))} /></label><label className="label">Lesson content<textarea className="input mt-1" rows={4} value={lessonForm.content} onChange={e => setLessonForm(f => ({ ...f, content: e.target.value }))} /></label><label className="label">Video URL (optional)<input className="input mt-1" type="url" value={lessonForm.videoUrl} onChange={e => setLessonForm(f => ({ ...f, videoUrl: e.target.value }))} /></label><label className="label">Duration in minutes<input className="input mt-1" type="number" min="1" value={lessonForm.duration} onChange={e => setLessonForm(f => ({ ...f, duration: e.target.value }))} /></label>{saveLesson.isError && <p className="text-sm text-red-600">Couldn’t save the lesson. Check the details and try again.</p>}</div><div className="flex gap-3 mt-5"><button className="btn-secondary flex-1" onClick={() => setLessonEditorOpen(false)}>Cancel</button><button className="btn-primary flex-1" disabled={!lessonForm.title.trim() || saveLesson.isPending} onClick={() => saveLesson.mutate()}>{saveLesson.isPending ? 'Saving…' : 'Save Lesson'}</button></div></div></div>}
    </DashboardLayout>
  );
}
