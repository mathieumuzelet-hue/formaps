import { ChangePasswordForm } from '@/components/account/ChangePasswordForm'

export default function ChangePasswordPage() {
  return (
    <div className="mx-auto w-full max-w-[860px] px-5 py-8 md:px-10">
      <h1 className="font-serif text-[30px] font-medium tracking-[-0.02em]">
        Mon compte
      </h1>
      <p className="mt-3 text-[14.5px] text-sub">
        Changez votre mot de passe de connexion au Cockpit.
      </p>
      <ChangePasswordForm />
    </div>
  )
}
