import { useStore } from '@nanostores/react'
import { Toaster as Sonner, type ToasterProps } from 'sonner'
import { $theme } from '@/modules/stores/$theme'

const Toaster = ({ ...props }: ToasterProps) => {
  const theme = useStore($theme)

  return (
    <Sonner
      theme={theme as ToasterProps['theme']}
      closeButton
      className="toaster group"
      toastOptions={{
        classNames: {
          toast:
            'group toast group-[.toaster]:bg-background group-[.toaster]:text-foreground group-[.toaster]:border-border group-[.toaster]:shadow-lg',
          description: 'group-[.toast]:text-muted-foreground',
          actionButton:
            'group-[.toast]:bg-primary group-[.toast]:text-primary-foreground font-medium',
          cancelButton:
            'group-[.toast]:bg-muted group-[.toast]:text-muted-foreground font-medium',
          closeButton:
            'group-[.toast]:bg-background group-[.toast]:text-muted-foreground group-[.toast]:border-border hover:group-[.toast]:text-foreground',
        },
      }}
      {...props}
    />
  )
}

export { Toaster }
