import yaml from 'js-yaml'

/**
 * Export current roster data to YAML format
 */
export function exportToYAML(data) {
  if (!data) {
    throw new Error('No data to export')
  }

  try {
    const yamlString = yaml.dump(data, {
      indent: 2,
      lineWidth: 120,
      noRefs: true,
      sortKeys: false
    })
    
    return yamlString
  } catch (err) {
    throw new Error(`Failed to convert data to YAML: ${err.message}`)
  }
}

/**
 * Download YAML content as a file
 */
export function downloadYAML(yamlContent, filename = 'roster-data.yaml') {
  const blob = new Blob([yamlContent], { type: 'text/yaml;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
  URL.revokeObjectURL(url)
}
