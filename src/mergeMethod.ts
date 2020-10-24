import * as core from '@actions/core'

export type MergeMethod = 'merge' | 'rebase' | 'squash'

export const mapMergeMethod = (mergeMethod: string): MergeMethod => {
  switch (mergeMethod) {
    case 'merge':
      return 'merge'
    case 'rebase':
      return 'rebase'
    case 'squash':
      return 'squash'
    default:
      core.warning(
        `Unknown merge method provided to the script: "${mergeMethod}", using default "merge" method.`
      )
      return 'merge'
  }
}
