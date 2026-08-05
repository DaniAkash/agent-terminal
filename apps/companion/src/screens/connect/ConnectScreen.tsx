import { Redirect } from 'expo-router'
import type { ReactNode } from 'react'
import { type Control, Controller, type FieldErrors } from 'react-hook-form'
import { Pressable, Text, TextInput, View } from 'react-native'
import { useConnectData } from './connect.data'
import { connectErrorMessage } from './connect.helpers'
import type { ConnectInputs } from './connect.schemas'

export function ConnectScreen() {
  const { form, onSubmit, status, serverError } = useConnectData()

  if (status === 'connected') return <Redirect href="/" />

  const {
    control,
    formState: { errors, isSubmitting },
  } = form
  const disabled = isSubmitting || status === 'connecting'
  const serverMessage = connectErrorMessage(status, serverError)

  return (
    <View className="flex-1 bg-background p-6">
      <View className="gap-6">
        <ConnectHeader />
        <UrlField control={control} errors={errors} />
        <TokenField control={control} errors={errors} />
        <FormErrors rootMessage={errors.root?.message} server={serverMessage} />
        <SubmitButton onPress={onSubmit} disabled={disabled} />
      </View>
    </View>
  )
}

function ConnectHeader() {
  return (
    <View className="gap-2">
      <Text className="font-semibold text-2xl text-foreground">
        Pair with desktop
      </Text>
      <Text className="text-muted-foreground text-sm">
        Enter the WSS URL and token from the desktop's dev config file.
      </Text>
    </View>
  )
}

function LabeledField({
  label,
  error,
  children,
}: {
  label: string
  error: string | undefined
  children: ReactNode
}) {
  return (
    <View className="gap-2">
      <Text className="text-muted-foreground text-xs uppercase tracking-wide">
        {label}
      </Text>
      {children}
      {error && <Text className="text-destructive text-xs">{error}</Text>}
    </View>
  )
}

type FieldProps = {
  control: Control<ConnectInputs>
  errors: FieldErrors<ConnectInputs>
}

function UrlField({ control, errors }: FieldProps) {
  return (
    <LabeledField label="WSS URL" error={errors.url?.message}>
      <Controller
        control={control}
        name="url"
        render={({ field: { onChange, value, onBlur } }) => (
          <TextInput
            className="rounded-md border border-input bg-card px-3 py-3 text-foreground"
            placeholder="ws://192.168.1.42:47823/stream"
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="url"
            value={value}
            onBlur={onBlur}
            onChangeText={onChange}
          />
        )}
      />
    </LabeledField>
  )
}

function TokenField({ control, errors }: FieldProps) {
  return (
    <LabeledField label="Token" error={errors.token?.message}>
      <Controller
        control={control}
        name="token"
        render={({ field: { onChange, value, onBlur } }) => (
          <TextInput
            className="rounded-md border border-input bg-card px-3 py-3 font-mono text-foreground"
            placeholder="paste the UUID from companion-dev.json"
            autoCapitalize="none"
            autoCorrect={false}
            value={value}
            onBlur={onBlur}
            onChangeText={onChange}
          />
        )}
      />
    </LabeledField>
  )
}

function FormErrors({
  rootMessage,
  server,
}: {
  rootMessage: string | undefined
  server: string | null
}) {
  return (
    <>
      {rootMessage && (
        <Text className="text-destructive text-sm">{rootMessage}</Text>
      )}
      {server && <Text className="text-destructive text-sm">{server}</Text>}
    </>
  )
}

function SubmitButton({
  onPress,
  disabled,
}: {
  onPress: () => void
  disabled: boolean
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      className="items-center rounded-md bg-accent px-4 py-3"
    >
      <Text className="font-semibold text-accent-foreground text-base">
        {disabled ? 'Connecting…' : 'Connect'}
      </Text>
    </Pressable>
  )
}
