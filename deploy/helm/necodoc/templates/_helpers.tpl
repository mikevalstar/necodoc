{{- define "necodoc.fullname" -}}
{{- if contains .Chart.Name .Release.Name -}}
{{- .Release.Name | trunc 63 | trimSuffix "-" -}}
{{- else -}}
{{- printf "%s-%s" .Release.Name .Chart.Name | trunc 63 | trimSuffix "-" -}}
{{- end -}}
{{- end -}}

{{- define "necodoc.labels" -}}
app.kubernetes.io/name: {{ .Chart.Name }}
app.kubernetes.io/instance: {{ .Release.Name }}
app.kubernetes.io/version: {{ .Chart.AppVersion | quote }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
helm.sh/chart: {{ printf "%s-%s" .Chart.Name .Chart.Version }}
{{- end -}}

{{/* Selector labels for one component: api, worker, app or migrate. */}}
{{- define "necodoc.selector" -}}
app.kubernetes.io/name: {{ .root.Chart.Name }}
app.kubernetes.io/instance: {{ .root.Release.Name }}
app.kubernetes.io/component: {{ .component }}
{{- end -}}

{{- define "necodoc.image" -}}
{{ .Values.image.repository }}:{{ .Values.image.tag | default .Chart.AppVersion }}
{{- end -}}

{{- define "necodoc.secretName" -}}
{{ .Values.secrets.existingSecret | default (printf "%s-env" (include "necodoc.fullname" .)) }}
{{- end -}}

{{- define "necodoc.serviceAccountName" -}}
{{ .Values.serviceAccount.name | default (ternary (include "necodoc.fullname" .) "default" .Values.serviceAccount.create) }}
{{- end -}}

{{- define "necodoc.claimName" -}}
{{ .Values.storage.disk.existingClaim | default (printf "%s-files" (include "necodoc.fullname" .)) }}
{{- end -}}

{{/* Env for every necodoc container: ConfigMap, Secret, then the role and extras. */}}
{{- define "necodoc.env" -}}
envFrom:
  - configMapRef:
      name: {{ include "necodoc.fullname" .root }}-env
  - secretRef:
      name: {{ include "necodoc.secretName" .root }}
env:
  - name: ROLE
    value: {{ .role }}
  - name: APP_VERSION
    value: {{ .root.Values.image.tag | default .root.Chart.AppVersion | quote }}
  {{- with .root.Values.extraEnv }}
  {{- toYaml . | nindent 2 }}
  {{- end }}
{{- end -}}

{{/* /tmp for Chromium and Node (the root filesystem is read-only), plus disk storage. */}}
{{- define "necodoc.volumeMounts" -}}
volumeMounts:
  - name: tmp
    mountPath: /tmp
  {{- if eq .Values.storage.driver "disk" }}
  - name: files
    mountPath: /data/files
  {{- end }}
{{- end -}}

{{- define "necodoc.volumes" -}}
volumes:
  - name: tmp
    emptyDir: {}
  {{- if eq .Values.storage.driver "disk" }}
  - name: files
    persistentVolumeClaim:
      claimName: {{ include "necodoc.claimName" . }}
  {{- end }}
{{- end -}}

{{- define "necodoc.probes" -}}
startupProbe:
  httpGet: { path: /api/health, port: http }
  periodSeconds: 2
  failureThreshold: 60
livenessProbe:
  httpGet: { path: /api/health, port: http }
  periodSeconds: 10
  failureThreshold: 3
readinessProbe:
  httpGet: { path: /api/health/ready, port: http }
  periodSeconds: 10
  timeoutSeconds: 6
  failureThreshold: 3
{{- end -}}

{{/* Restart pods when their env changes. */}}
{{- define "necodoc.checksums" -}}
checksum/config: {{ include (print .Template.BasePath "/configmap.yaml") . | sha256sum }}
checksum/secret: {{ include (print .Template.BasePath "/secret.yaml") . | sha256sum }}
{{- end -}}
