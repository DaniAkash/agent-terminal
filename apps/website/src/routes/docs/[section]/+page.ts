import { error } from '@sveltejs/kit'
import { docSections } from '../doc-sections'
import type { PageLoad } from './$types'

export const load: PageLoad = ({ params }) => {
  if (
    !docSections.some(
      (section) => section.id === params.section && section.id !== 'overview',
    )
  )
    error(404, 'Documentation page not found')
  return { section: params.section }
}
