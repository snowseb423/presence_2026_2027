import { LogOut, UserPlus } from 'lucide-react'
import { useId, useState } from 'react'
import { useAuth } from '../../auth/AuthProvider.tsx'
import { useData, useSyncState } from '../../data/DataProvider.tsx'
import { addMember, isValidEmail, removeMember, renameMember } from '../../data/members.ts'
import type { Member } from '../../domain/types.ts'
import { useToast } from '../../ui/Toaster.tsx'
import { Button, Card, inputClass } from '../../ui/controls.tsx'

function MemberRow({ member, isMe, online }: { member: Member; isMe: boolean; online: boolean }) {
  const { db } = useData()
  const toast = useToast()
  const [renaming, setRenaming] = useState(false)
  const [name, setName] = useState(member.displayName ?? '')
  const [busy, setBusy] = useState(false)

  async function run(task: () => Promise<void>, success: string) {
    setBusy(true)
    try {
      await task()
      toast({ message: success })
      setRenaming(false)
    } catch (error) {
      toast({ message: (error as Error).message, tone: 'error' })
    } finally {
      setBusy(false)
    }
  }

  return (
    <li className="px-4 py-3">
      {renaming ? (
        <form
          className="flex items-center gap-2"
          onSubmit={(event) => {
            event.preventDefault()
            void run(() => renameMember(db, member.email, name), 'Nom modifié')
          }}
        >
          <input
            value={name}
            onChange={(event) => setName(event.target.value)}
            maxLength={60}
            aria-label={`Nom affiché pour ${member.email}`}
            className={`${inputClass} min-h-11`}
            autoFocus
          />
          <Button type="submit" variant="primary" disabled={busy}>
            OK
          </Button>
          <Button variant="quiet" onClick={() => setRenaming(false)}>
            Annuler
          </Button>
        </form>
      ) : (
        <div className="flex items-center gap-2">
          <div className="min-w-0 flex-1">
            <p className="font-bold text-ink">
              {member.displayName ?? member.email.split('@')[0]}
              {isMe ? <span className="ml-2 rounded-full bg-accent-soft px-2 py-0.5 text-xs font-bold text-accent-strong">vous</span> : null}
            </p>
            <p className="truncate text-sm text-ink-2">
              {member.email}
              {member.userId ? '' : ' · pas encore connecté'}
            </p>
          </div>
          <Button variant="ghost" disabled={!online} onClick={() => setRenaming(true)}>
            Renommer
          </Button>
          {!isMe ? (
            <Button
              variant="ghost"
              disabled={!online || busy}
              onClick={() => {
                if (window.confirm(`Retirer ${member.email} ? Cette adresse ne pourra plus se connecter.`)) {
                  void run(() => removeMember(db, member.email), 'Accès retiré')
                }
              }}
            >
              Retirer
            </Button>
          ) : null}
        </div>
      )}
    </li>
  )
}

export function AccountsSection({ members, pending }: { members: Member[]; pending: number }) {
  const { state, signOut } = useAuth()
  const { db, engine } = useData()
  const sync = useSyncState()
  const toast = useToast()
  const id = useId()
  const [email, setEmail] = useState('')
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const me = state.status === 'signedIn' ? state.user : null
  const online = sync.online

  async function add() {
    if (!isValidEmail(email)) {
      toast({ message: 'Adresse email invalide.', tone: 'error' })
      return
    }
    setBusy(true)
    try {
      await addMember(db, email, name)
      toast({ message: `${email.trim()} peut maintenant se connecter` })
      setEmail('')
      setName('')
    } catch (error) {
      toast({ message: (error as Error).message, tone: 'error' })
    } finally {
      setBusy(false)
    }
  }

  async function logout() {
    const message = pending
      ? `${pending} modification${pending > 1 ? 's' : ''} pas encore envoyée${pending > 1 ? 's' : ''} ser${pending > 1 ? 'ont' : 'a'} perdue${pending > 1 ? 's' : ''}. Se déconnecter quand même ?`
      : 'Se déconnecter de cet appareil ? Les données en cache y seront effacées.'
    if (!window.confirm(message)) return
    await engine.clearLocalData()
    try {
      await caches?.delete('presence-data')
    } catch {
      /* Cache Storage indisponible */
    }
    await signOut()
  }

  return (
    <>
      <Card padded={false}>
        <ul className="divide-y divide-line">
          {members.map((member) => (
            <MemberRow key={member.email} member={member} isMe={member.email === me?.email.toLowerCase()} online={online} />
          ))}
          {members.length === 0 ? <li className="px-4 py-3 text-ink-2">Liste disponible après la première synchronisation.</li> : null}
        </ul>
        <form
          className="border-t border-line p-4"
          onSubmit={(event) => {
            event.preventDefault()
            void add()
          }}
        >
          <p className="mb-2 font-bold text-ink">Autoriser une adresse</p>
          <div className="flex flex-col gap-2">
            <input
              id={`${id}-email`}
              type="email"
              inputMode="email"
              autoComplete="off"
              placeholder="adresse@exemple.com"
              aria-label="Adresse email à autoriser"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              className={inputClass}
            />
            <input
              placeholder="Nom affiché (facultatif)"
              aria-label="Nom affiché"
              maxLength={60}
              value={name}
              onChange={(event) => setName(event.target.value)}
              className={inputClass}
            />
            <Button type="submit" variant="secondary" disabled={!online || busy || !email.trim()}>
              <UserPlus size={18} aria-hidden="true" />
              Autoriser
            </Button>
          </div>
          {!online ? <p className="mt-2 text-sm text-ink-2">La gestion des comptes nécessite une connexion.</p> : null}
        </form>
      </Card>
      <div className="mt-3">
        <Button variant="danger" className="w-full" onClick={() => void logout()}>
          <LogOut size={18} aria-hidden="true" />
          Se déconnecter{me ? ` (${me.email})` : ''}
        </Button>
      </div>
    </>
  )
}
