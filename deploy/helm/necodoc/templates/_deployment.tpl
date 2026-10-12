{{/* The api and worker Deployments: same image, ROLE decides (ADR 0020). */}}
{{- define "necodoc.deployment" -}}
{{- $root := .root -}}
{{- $v := index $root.Values .role -}}
apiVersion: apps/v1
kind: Deployment
metadata:
  name: {{ include "necodoc.fullname" $root }}-{{ .role }}
  labels:
    {{- include "necodoc.labels" $root | nindent 4 }}
    app.kubernetes.io/component: {{ .role }}
spec:
  {{- if not (and (eq .role "worker") (or $v.autoscaling.enabled $v.keda.enabled)) }}
  replicas: {{ $v.replicas }}
  {{- end }}
  selector:
    matchLabels:
      {{- include "necodoc.selector" (dict "root" $root "component" .role) | nindent 6 }}
  template:
    metadata:
      labels:
        {{- include "necodoc.labels" $root | nindent 8 }}
        app.kubernetes.io/component: {{ .role }}
      annotations:
        {{- include "necodoc.checksums" $root | nindent 8 }}
        {{- if and $root.Values.metrics.enabled $root.Values.metrics.podAnnotations }}
        prometheus.io/scrape: "true"
        prometheus.io/port: {{ $root.Values.metrics.port | quote }}
        prometheus.io/path: /metrics
        {{- end }}
    spec:
      serviceAccountName: {{ include "necodoc.serviceAccountName" $root }}
      {{- with $root.Values.imagePullSecrets }}
      imagePullSecrets:
        {{- toYaml . | nindent 8 }}
      {{- end }}
      securityContext:
        {{- toYaml $root.Values.podSecurityContext | nindent 8 }}
      {{- with $v.terminationGracePeriodSeconds }}
      terminationGracePeriodSeconds: {{ . }}
      {{- end }}
      containers:
        - name: {{ .role }}
          image: {{ include "necodoc.image" $root }}
          imagePullPolicy: {{ $root.Values.image.pullPolicy }}
          args: [serve]
          {{- include "necodoc.env" (dict "root" $root "role" .role) | nindent 10 }}
          ports:
            - name: http
              containerPort: 3000
            {{- if $root.Values.metrics.enabled }}
            - name: metrics
              containerPort: {{ $root.Values.metrics.port }}
            {{- end }}
          {{- include "necodoc.probes" $root | nindent 10 }}
          resources:
            {{- toYaml $v.resources | nindent 12 }}
          securityContext:
            {{- toYaml $root.Values.securityContext | nindent 12 }}
          {{- include "necodoc.volumeMounts" $root | nindent 10 }}
      {{- include "necodoc.volumes" $root | nindent 6 }}
      {{- with $v.nodeSelector }}
      nodeSelector:
        {{- toYaml . | nindent 8 }}
      {{- end }}
      {{- with $v.tolerations }}
      tolerations:
        {{- toYaml . | nindent 8 }}
      {{- end }}
      {{- with $v.affinity }}
      affinity:
        {{- toYaml . | nindent 8 }}
      {{- end }}
{{- end -}}
