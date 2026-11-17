import { useCallback, useEffect, useState } from 'react'
import type { FormEvent } from 'react'

type User = { id: string; name: string; email: string; role: 'admin' | 'participant' }
type FormFieldType =
  | 'shortText'
  | 'longText'
  | 'email'
  | 'number'
  | 'singleChoice'
  | 'multipleChoice'
  | 'image'
  | 'video'
type FormField = {
  id: string
  label: string
  type: FormFieldType
  required: boolean
  options: string[]
}
type UploadedAnswer = { url: string; originalName: string; contentType: string }
type AnswerValue = string | number | string[] | UploadedAnswer | null
type ApplicationAnswer = { fieldId: string; label: string; type: FormFieldType; value: AnswerValue }
type EventItem = {
  _id: string
  title: string
  description: string
  deadline: string
  thumbnail: string
  participantCount: number
  isApplied: boolean
  formFields: FormField[]
}
type Applicant = {
  name: string
  email: string
  appliedAt: string
  answers: ApplicationAnswer[]
}
const apiBaseUrl = (
  import.meta.env.VITE_API_URL ||
  (import.meta.env.PROD ? 'https://stackcartevents.onrender.com' : '')
).replace(/\/+$/, '')
const apiUrl = (path: string) => `${apiBaseUrl}${path}`

const api = async <T,>(path: string, options: RequestInit = {}): Promise<T> => {
  const isForm = options.body instanceof FormData
  const response = await fetch(apiUrl(`/api${path}`), {
    credentials: 'include',
    ...options,
    headers: {
      ...(isForm ? {} : { 'Content-Type': 'application/json' }),
      ...options.headers,
    },
  })
  const result = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(result.message || 'Something went wrong.')
  return result as T
}

const dateLabel = (value: string) =>
  new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(value))

const localDateTime = (value: string) => {
  const date = new Date(value)
  date.setMinutes(date.getMinutes() - date.getTimezoneOffset())
  return date.toISOString().slice(0, 16)
}

function App() {
  const [user, setUser] = useState<User | null>(null)
  const [events, setEvents] = useState<EventItem[]>([])
  const [view, setView] = useState<'events' | 'admin' | 'login' | 'register'>('events')
  const [notice, setNotice] = useState('')
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [authBusy, setAuthBusy] = useState(false)
  const [formBusy, setFormBusy] = useState(false)
  const [editing, setEditing] = useState<EventItem | null>(null)
  const [formFields, setFormFields] = useState<FormField[]>([])
  const [applicationEvent, setApplicationEvent] = useState<EventItem | null>(null)
  const [applicationBusy, setApplicationBusy] = useState(false)
  const [selected, setSelected] = useState<EventItem | null>(null)
  const [applicants, setApplicants] = useState<Applicant[]>([])
  const [rosterBusy, setRosterBusy] = useState(false)

  const loadEvents = useCallback(async () => {
    try {
      const result = await api<{ events: EventItem[] }>('/events')
      setEvents(result.events)
      setLoadError('')
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : 'Unable to load events.')
      throw error
    }
  }, [])

  useEffect(() => {
    Promise.all([
      api<{ user: User | null }>('/auth/me').then(({ user: current }) => setUser(current)).catch(() => {}),
      loadEvents(),
    ])
      .catch((error: Error) => setNotice(error.message))
      .finally(() => setLoading(false))
  }, [loadEvents])

  const submitAuth = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setAuthBusy(true)
    setNotice('')
    const data = new FormData(event.currentTarget)
    const endpoint = view === 'register' ? '/auth/register' : '/auth/login'
    const payload = Object.fromEntries(data.entries())
    try {
      const result = await api<{ user: User }>(endpoint, {
        method: 'POST',
        body: JSON.stringify(payload),
      })
      setUser(result.user)
      setView(result.user.role === 'admin' ? 'admin' : 'events')
      await loadEvents()
      setNotice(`Welcome${result.user.name ? `, ${result.user.name}` : ''}.`)
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'Unable to sign in.')
    } finally {
      setAuthBusy(false)
    }
  }

  const signOut = async () => {
    try {
      await api('/auth/logout', { method: 'POST' })
      setUser(null)
      setView('events')
      await loadEvents()
      setNotice('You have been signed out.')
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'Unable to sign out.')
    }
  }

  const apply = async (event: EventItem) => {
    if (!user) {
      setView('login')
      setNotice('Sign in to apply for an event.')
      return
    }
    if (event.isApplied) {
      setNotice('You have already applied for this event.')
      return
    }
    if (event.formFields.length) {
      setApplicationEvent(event)
      return
    }
    try {
      await api(`/events/${event._id}/apply`, { method: 'POST' })
      setNotice(`Your application for “${event.title}” is confirmed.`)
      await loadEvents()
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'Unable to apply.')
    }
  }

  const submitApplication = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!applicationEvent) return
    setApplicationBusy(true)
    const formData = new FormData(event.currentTarget)
    const answers: Record<string, FormDataEntryValue | FormDataEntryValue[]> = {}
    for (const field of applicationEvent.formFields) {
      if (field.type === 'image' || field.type === 'video') {
        const file = formData.get(field.id)
        if (file instanceof File && file.size) formData.append(`file_${field.id}`, file)
        formData.delete(field.id)
      } else if (field.type === 'multipleChoice') {
        answers[field.id] = formData.getAll(field.id)
      } else {
        answers[field.id] = formData.get(field.id) || ''
      }
    }
    formData.set('answers', JSON.stringify(answers))
    for (const field of applicationEvent.formFields) formData.delete(field.id)
    try {
      await api(`/events/${applicationEvent._id}/apply`, { method: 'POST', body: formData })
      const eventTitle = applicationEvent.title
      setApplicationEvent(null)
      await loadEvents()
      setNotice(`Your application for “${eventTitle}” is confirmed.`)
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'Unable to apply.')
    } finally {
      setApplicationBusy(false)
    }
  }

  const openRoster = async (event: EventItem) => {
    setSelected(event)
    setRosterBusy(true)
    setApplicants([])
    try {
      const result = await api<{ participants: Applicant[] }>(
        `/events/${event._id}/participants`,
      )
      setApplicants(result.participants)
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'Unable to load participants.')
    } finally {
      setRosterBusy(false)
    }
  }

  const saveEvent = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const form = event.currentTarget
    setFormBusy(true)
    setNotice('')
    const formData = new FormData(form)
    const thumbnail = formData.get('thumbnail')
    if (thumbnail instanceof File && thumbnail.size === 0) formData.delete('thumbnail')
    formData.set('formFields', JSON.stringify(formFields))
    const method = editing ? 'PATCH' : 'POST'
    const path = editing ? `/events/${editing._id}` : '/events'
    try {
      await api(path, { method, body: formData })
      setEditing(null)
      setFormFields([])
      form.reset()
      await loadEvents()
      setNotice(editing ? 'Event updated.' : 'Event created.')
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'Unable to save event.')
    } finally {
      setFormBusy(false)
    }
  }

  const deleteEvent = async (event: EventItem) => {
    if (!window.confirm(`Delete “${event.title}” and its participant records?`)) return
    try {
      await api(`/events/${event._id}`, { method: 'DELETE' })
      if (selected?._id === event._id) setSelected(null)
      await loadEvents()
      setNotice('Event deleted.')
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'Unable to delete event.')
    }
  }

  const startEditing = (event: EventItem) => {
    setSelected(null)
    setEditing(event)
    setFormFields(event.formFields || [])
    window.setTimeout(() => {
      document.getElementById('event-form')?.scrollIntoView({ behavior: 'smooth' })
    }, 0)
  }

  const addFormField = () => {
    setFormFields((fields) => fields.length >= 30 ? fields : [
      ...fields,
      { id: crypto.randomUUID(), label: '', type: 'shortText', required: true, options: [] },
    ])
  }

  const updateFormField = (id: string, updates: Partial<FormField>) => {
    setFormFields((fields) => fields.map((field) => field.id === id ? { ...field, ...updates } : field))
  }

  return (
    <div className="app-shell">
      <header className="topbar">
        <button className="wordmark" onClick={() => setView('events')} aria-label="StackCart Events home">
          <span className="brand-mark">S</span>
          <span>stackcart<span className="brand-light"> events</span></span>
        </button>
        <nav className="nav-actions" aria-label="Main navigation">
          <button className={view === 'events' ? 'nav-link active' : 'nav-link'} onClick={() => setView('events')}>
            Discover
          </button>
          {user?.role === 'admin' && (
            <button className={view === 'admin' ? 'nav-link active' : 'nav-link'} onClick={() => setView('admin')}>
              Admin portal
            </button>
          )}
          {user ? (
            <div className="account-actions">
              <span className="user-greeting">{user.name}</span>
              <button className="button button-outline button-small" onClick={signOut}>Sign out</button>
            </div>
          ) : (
            <button className="button button-dark button-small" onClick={() => setView('login')}>Sign in</button>
          )}
        </nav>
      </header>

      <main>
        {notice && (
          <div className="notice" role="status">
            <span>{notice}</span>
            <button onClick={() => setNotice('')} aria-label="Dismiss message">×</button>
          </div>
        )}

        {view === 'login' || view === 'register' ? (
          <section className="auth-layout">
            <div className="auth-story">
              <span className="eyebrow">THE STACKCART COMMUNITY</span>
              <h1>Make room for<br /><span>what’s next.</span></h1>
              <p>Meet curious minds, discover fresh ideas, and be part of the conversations shaping what comes next.</p>
              <div className="auth-decoration"><span>Ideas in motion</span><span className="decoration-arrow">↗</span></div>
            </div>
            <form className="auth-card" onSubmit={submitAuth}>
              <span className="eyebrow">{view === 'login' ? 'WELCOME BACK' : 'JOIN THE COMMUNITY'}</span>
              <h2>{view === 'login' ? 'Sign in' : 'Create your account'}</h2>
              <p className="muted">{view === 'login' ? 'Your next event is waiting.' : 'It only takes a moment to get started.'}</p>
              {view === 'register' && (
                <label>Full name<input name="name" autoComplete="name" minLength={2} maxLength={80} required /></label>
              )}
              <label>Email address<input name="email" type="email" autoComplete="email" required /></label>
              <label>Password<input name="password" type="password" autoComplete={view === 'login' ? 'current-password' : 'new-password'} minLength={8} maxLength={72} required /></label>
              <button className="button button-green button-full" disabled={authBusy}>
                {authBusy ? 'Please wait…' : view === 'login' ? 'Sign in' : 'Create account'}
              </button>
              <p className="auth-switch">
                {view === 'login' ? 'New to StackCart Events?' : 'Already have an account?'}{' '}
                <button type="button" onClick={() => setView(view === 'login' ? 'register' : 'login')}>
                  {view === 'login' ? 'Create account' : 'Sign in'}
                </button>
              </p>
            </form>
          </section>
        ) : view === 'admin' && user?.role === 'admin' ? (
          <section className="content-section admin-section">
            <div className="section-heading admin-heading">
              <div><span className="eyebrow">WORKSPACE</span><h1>Event management</h1><p>Keep your community in the loop.</p></div>
              <div className="stat-pill"><strong>{events.length}</strong><span>events</span></div>
            </div>

            <div className="admin-grid">
              <form id="event-form" key={editing?._id || 'new'} className="panel event-form" onSubmit={saveEvent}>
                <div className="panel-heading">
                  <div><span className="eyebrow">{editing ? 'UPDATE DETAILS' : 'PUBLISH SOMETHING NEW'}</span><h2>{editing ? 'Edit event' : 'Create an event'}</h2></div>
                  {editing && <button type="button" className="text-button" onClick={() => { setEditing(null); setFormFields([]) }}>Cancel edit</button>}
                </div>
                <label>Event title<input name="title" defaultValue={editing?.title || ''} maxLength={120} required /></label>
                <label>Description<textarea name="description" rows={6} defaultValue={editing?.description || ''} maxLength={20000} required /></label>
                <label>Application deadline<input name="deadline" type="datetime-local" defaultValue={editing ? localDateTime(editing.deadline) : ''} required /></label>
                <label>Thumbnail <span className="field-note">{editing ? 'Choose a new image to replace the current one.' : 'JPEG, PNG or WebP, up to 5 MB.'}</span>
                  <input name="thumbnail" type="file" accept="image/jpeg,image/png,image/webp" required={!editing} />
                </label>
                <div className="form-builder">
                  <div className="form-builder-heading">
                    <div><span className="eyebrow">PARTICIPANT APPLICATION</span><h3>Build your form</h3></div>
                    <span className="field-note">{formFields.length}/30 questions</span>
                  </div>
                  <p className="builder-description">Add the questions people should answer when they apply. File answers are private to admins.</p>
                  {formFields.map((field, index) => (
                    <div className="question-editor" key={field.id}>
                      <div className="question-editor-top">
                        <span className="question-number">QUESTION {String(index + 1).padStart(2, '0')}</span>
                        <button type="button" className="text-button remove-question" onClick={() => setFormFields((fields) => fields.filter((item) => item.id !== field.id))}>Remove</button>
                      </div>
                      <label>Question<input value={field.label} onChange={(event) => updateFormField(field.id, { label: event.target.value })} maxLength={120} placeholder="e.g. Tell us about your idea" required /></label>
                      <label>Answer type
                        <select value={field.type} onChange={(event) => {
                          const type = event.target.value as FormFieldType
                          updateFormField(field.id, {
                            type,
                            options: type === 'singleChoice' || type === 'multipleChoice' ? ['Option 1', 'Option 2'] : [],
                          })
                        }}>
                          <option value="shortText">Short answer</option>
                          <option value="longText">Long answer</option>
                          <option value="email">Email</option>
                          <option value="number">Number</option>
                          <option value="singleChoice">Multiple choice (one answer)</option>
                          <option value="multipleChoice">Checkboxes (multiple answers)</option>
                          <option value="image">Image upload</option>
                          <option value="video">Video upload</option>
                        </select>
                      </label>
                      {(field.type === 'singleChoice' || field.type === 'multipleChoice') && (
                        <label>Options <span className="field-note">Enter one choice per line, at least two.</span>
                          <textarea rows={3} value={field.options.join('\n')} onChange={(event) => updateFormField(field.id, { options: event.target.value.split('\n') })} required />
                        </label>
                      )}
                      {(field.type === 'image' || field.type === 'video') && (
                        <p className="field-note upload-note">{field.type === 'image' ? 'JPEG, PNG, GIF or WebP · up to 10 MB per answer.' : 'MP4, WebM, MOV or MKV · up to 50 MB per answer.'}</p>
                      )}
                      <label className="required-toggle"><input type="checkbox" checked={field.required} onChange={(event) => updateFormField(field.id, { required: event.target.checked })} /> Required question</label>
                    </div>
                  ))}
                  <button type="button" className="button button-outline button-full add-question" onClick={addFormField} disabled={formFields.length >= 30}>+ Add a question</button>
                </div>
                <button className="button button-green button-full" disabled={formBusy}>
                  {formBusy ? 'Saving…' : editing ? 'Save changes' : 'Publish event'}
                </button>
              </form>

              <div className="panel event-list-panel">
                <div className="panel-heading"><div><span className="eyebrow">YOUR PROGRAMME</span><h2>All events <span className="count-badge">{events.length}</span></h2></div></div>
                {loading ? <p className="muted">Loading events…</p> : loadError ? (
                  <div className="empty-state"><h3>Events couldn’t load</h3><p>{loadError}</p><button className="text-button" onClick={() => void loadEvents()}>Try again</button></div>
                ) : events.length === 0 ? (
                  <div className="empty-state"><span className="empty-icon">✳</span><h3>No events yet</h3><p>Create your first event to get started.</p></div>
                ) : (
                  <div className="admin-event-list">
                    {events.map((event) => (
                      <article className="admin-event-row" key={event._id}>
                        <img src={apiUrl(event.thumbnail)} alt="" />
                        <div className="admin-event-info"><h3>{event.title}</h3><p>{event.participantCount} applicants · Deadline {dateLabel(event.deadline)}</p></div>
                        <div className="row-actions">
                          <button className="icon-button" title="View participants" onClick={() => void openRoster(event)}>People</button>
                          <button className="icon-button" title="Edit event" onClick={() => startEditing(event)}>Edit</button>
                          <button className="icon-button icon-danger" title="Delete event" onClick={() => void deleteEvent(event)}>Delete</button>
                        </div>
                      </article>
                    ))}
                  </div>
                )}
              </div>
            </div>

            {selected && (
              <section className="panel roster-panel">
                <div className="panel-heading">
                  <div><span className="eyebrow">APPLICATIONS</span><h2>{selected.title}</h2></div>
                  <button className="text-button" onClick={() => setSelected(null)}>Close roster</button>
                </div>
                {rosterBusy ? <p className="muted">Loading participants…</p> : applicants.length === 0 ? (
                  <div className="empty-state compact"><h3>No applications yet</h3><p>Applicants will appear here once they register.</p></div>
                ) : (
                  <div className="applicant-list">
                    {applicants.map((applicant) => (
                      <article className="applicant-card" key={`${applicant.email}-${applicant.appliedAt}`}>
                        <div className="applicant-heading"><div><h3>{applicant.name}</h3><a href={`mailto:${applicant.email}`}>{applicant.email}</a></div><span>Applied {dateLabel(applicant.appliedAt)}</span></div>
                        {applicant.answers.length > 0 && (
                          <dl className="answer-list">
                            {applicant.answers.map((answer) => (
                              <div key={answer.fieldId}><dt>{answer.label}</dt><dd>
                                {answer.value === null ? '—' :
                                  typeof answer.value === 'object' && !Array.isArray(answer.value) && 'url' in answer.value
                                    ? <a href={apiUrl(answer.value.url)} target="_blank" rel="noreferrer">View {answer.value.originalName}</a>
                                    : Array.isArray(answer.value) ? answer.value.join(', ') : String(answer.value)}
                              </dd></div>
                            ))}
                          </dl>
                        )}
                      </article>
                    ))}
                  </div>
                )}
              </section>
            )}
          </section>
        ) : (
          <>
            <section className="hero">
              <div className="hero-copy">
                <span className="eyebrow"><span className="eyebrow-dot" /> GOOD THINGS HAPPEN TOGETHER</span>
                <h1>Find your next<br /><span>great thing.</span></h1>
                <p>Ideas, people, and possibilities — all in one place. Find an event that moves you.</p>
                <button className="button button-green hero-button" onClick={() => document.getElementById('events')?.scrollIntoView({ behavior: 'smooth' })}>
                  Explore events <span aria-hidden="true">↓</span>
                </button>
              </div>
              <div className="hero-art" aria-hidden="true">
                <div className="hero-circle circle-one" /><div className="hero-circle circle-two" />
                <div className="art-card art-card-back"><span>IDEAS</span><div className="art-line" /><div className="art-line short" /></div>
                <div className="art-card art-card-front"><span className="art-spark">✳</span><span>Meet<br />what’s next.</span><span className="art-caption">STACKCART · COMMUNITY</span></div>
                <span className="art-orbit orbit-one">✦</span><span className="art-orbit orbit-two">✳</span>
              </div>
              <div className="hero-footnote"><span>01 — OPEN TO EVERYONE</span><span>CURATED BY STACKCART</span></div>
            </section>

            <section className="content-section events-section" id="events">
              <div className="section-heading">
                <div><span className="eyebrow">COME AS YOU ARE</span><h2>Find your people.</h2><p>Browse what’s coming up and save your seat.</p></div>
                <span className="events-count">{events.length.toString().padStart(2, '0')} <span>EVENTS</span></span>
              </div>
              {loading ? <div className="loading-state">Finding the good stuff…</div> : loadError ? (
                <div className="empty-state large"><h3>Events couldn’t load</h3><p>{loadError}</p><button className="text-button" onClick={() => void loadEvents()}>Try again</button></div>
              ) : events.length === 0 ? (
                <div className="empty-state large"><span className="empty-icon">✳</span><h3>Something good is in the works.</h3><p>There aren’t any events to show just yet. Check back soon.</p></div>
              ) : (
                <div className="event-grid">
                  {events.map((event, index) => {
                    const isOpen = new Date(event.deadline).getTime() > Date.now()
                    return (
                      <article className="event-card" key={event._id}>
                        <div className="event-image-wrap">
                          <img className="event-image" src={apiUrl(event.thumbnail)} alt="" />
                          <span className={isOpen ? 'event-status' : 'event-status closed'}>{isOpen ? 'APPLICATIONS OPEN' : 'APPLICATIONS CLOSED'}</span>
                          <span className="event-index">{String(index + 1).padStart(2, '0')}</span>
                        </div>
                        <div className="event-card-body">
                          <span className="event-deadline">APPLY BY <strong>{dateLabel(event.deadline)}</strong></span>
                          <h3>{event.title}</h3>
                          <p>{event.description}</p>
                          <div className="event-card-footer">
                            <span>{event.participantCount} {event.participantCount === 1 ? 'person' : 'people'} joined</span>
                            <button className="apply-button" disabled={!isOpen || event.isApplied || user?.role === 'admin'} onClick={() => void apply(event)}>
                              {!isOpen ? 'Closed' : event.isApplied ? 'Applied ✓' : user?.role === 'admin' ? 'Admin account' : 'I’m interested'} <span aria-hidden="true">↗</span>
                            </button>
                          </div>
                        </div>
                      </article>
                    )
                  })}
                </div>
              )}
            </section>
            <footer className="footer"><span className="footer-brand">stackcart<span> events</span></span><span>Make good things happen together.</span><span>© {new Date().getFullYear()} StackCart</span></footer>
          </>
        )}
        {applicationEvent && (
          <div className="modal-backdrop" role="presentation" onMouseDown={(event) => {
            if (event.target === event.currentTarget && !applicationBusy) setApplicationEvent(null)
          }}>
            <form className="application-modal" role="dialog" aria-modal="true" aria-labelledby="application-title" onSubmit={submitApplication}>
              <div className="panel-heading"><div><span className="eyebrow">YOUR APPLICATION</span><h2 id="application-title">{applicationEvent.title}</h2></div><button type="button" className="modal-close" aria-label="Close application" onClick={() => setApplicationEvent(null)} disabled={applicationBusy}>×</button></div>
              <p className="builder-description">Answer a few questions to complete your application.</p>
              {applicationEvent.formFields.map((field) => (
                <fieldset className="application-question" key={field.id}>
                  <legend>{field.label}{field.required && <span className="required-star"> *</span>}</legend>
                  {field.type === 'shortText' && <input name={field.id} type="text" aria-label={field.label} maxLength={500} required={field.required} />}
                  {field.type === 'longText' && <textarea name={field.id} aria-label={field.label} rows={4} maxLength={10000} required={field.required} />}
                  {field.type === 'email' && <input name={field.id} type="email" aria-label={field.label} maxLength={254} required={field.required} />}
                  {field.type === 'number' && <input name={field.id} type="number" aria-label={field.label} step="any" required={field.required} />}
                  {field.type === 'singleChoice' && <div className="choice-list">{field.options.map((option) => <label key={option}><input type="radio" name={field.id} value={option} required={field.required} />{option}</label>)}</div>}
                  {field.type === 'multipleChoice' && <div className="choice-list">{field.options.map((option) => <label key={option}><input type="checkbox" name={field.id} value={option} />{option}</label>)}</div>}
                  {field.type === 'image' && <input name={field.id} type="file" aria-label={field.label} accept="image/jpeg,image/png,image/webp,image/gif" required={field.required} />}
                  {field.type === 'video' && <input name={field.id} type="file" aria-label={field.label} accept="video/mp4,video/webm,video/quicktime,video/x-matroska" required={field.required} />}
                  {(field.type === 'image' || field.type === 'video') && <span className="field-note">Maximum file size: {field.type === 'image' ? '10 MB' : '50 MB'}.</span>}
                </fieldset>
              ))}
              <div className="modal-actions"><button type="button" className="button button-outline" onClick={() => setApplicationEvent(null)} disabled={applicationBusy}>Cancel</button><button className="button button-green" disabled={applicationBusy}>{applicationBusy ? 'Submitting…' : 'Submit application'}</button></div>
            </form>
          </div>
        )}
      </main>
    </div>
  )
}

export default App
