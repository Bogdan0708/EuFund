variable "aws_region" {
  type        = string
  description = "AWS region for deployment."
  default     = "eu-west-2"
}

variable "gcp_project_id" {
  type        = string
  description = "GCP project ID for Terraform state infrastructure."
  default     = "eu-funds-prod"
}

variable "gcp_region" {
  type        = string
  description = "GCP region for state encryption resources."
  default     = "europe-west1"
}

variable "app_name" {
  type        = string
  description = "Application name prefix."
  default     = "eu-funds"
}

variable "domain_name" {
  type        = string
  description = "Primary public domain name."
}

variable "hosted_zone_id" {
  type        = string
  description = "Route53 hosted zone ID."
}

variable "alb_certificate_arn" {
  type        = string
  description = "ACM certificate ARN for ALB (same region as ALB)."
}

variable "cloudfront_certificate_arn" {
  type        = string
  description = "ACM certificate ARN in us-east-1 for CloudFront."
}

variable "db_username" {
  type        = string
  description = "RDS master username."
}

variable "db_password" {
  type        = string
  description = "RDS master password."
  sensitive   = true
}

variable "app_image" {
  type        = string
  description = "Container image for the app."
}

variable "nextauth_secret" {
  type        = string
  description = "NextAuth secret."
  sensitive   = true
}

variable "nextauth_url" {
  type        = string
  description = "NextAuth public URL."
}

variable "public_subnet_cidrs" {
  type        = list(string)
  description = "CIDR blocks for public subnets."
  default     = ["10.0.1.0/24", "10.0.2.0/24"]
}

variable "private_subnet_cidrs" {
  type        = list(string)
  description = "CIDR blocks for private subnets."
  default     = ["10.0.101.0/24", "10.0.102.0/24"]
}

variable "cloud_run_service_name" {
  type        = string
  description = "Existing Cloud Run service name exposed behind the external load balancer."
}

variable "cloud_run_region" {
  type        = string
  description = "Region where the Cloud Run service and serverless NEG are deployed."
  default     = "europe-west1"
}

variable "cloud_run_lb_domains" {
  type        = list(string)
  description = "Domains to include in the Google-managed SSL certificate."
}

variable "cloud_armor_policy_name" {
  type        = string
  description = "Cloud Armor security policy name for the Cloud Run backend."
  default     = "eu-funds-cloud-run-armor"
}

variable "cloud_armor_known_bad_ip_ranges" {
  type        = list(string)
  description = "CIDR ranges to block explicitly in Cloud Armor."
  default     = []
}

variable "cloud_armor_geo_blocked_country_codes" {
  type        = list(string)
  description = "Optional ISO country codes to block (e.g. [\"RU\", \"KP\"])."
  default     = []
}

variable "cloud_run_lb_ip_name" {
  type        = string
  description = "Global static IP resource name for the Cloud Run HTTPS load balancer."
  default     = "eu-funds-cloud-run-lb-ip"
}

variable "cloud_run_managed_cert_name" {
  type        = string
  description = "Managed SSL certificate resource name."
  default     = "eu-funds-cloud-run-managed-cert"
}

variable "cloud_run_neg_name" {
  type        = string
  description = "Serverless NEG name targeting Cloud Run."
  default     = "eu-funds-cloud-run-neg"
}

variable "cloud_run_backend_service_name" {
  type        = string
  description = "Backend service name for Cloud Run NEG."
  default     = "eu-funds-cloud-run-backend"
}

variable "cloud_run_url_map_name" {
  type        = string
  description = "URL map name for Cloud Run HTTPS load balancer."
  default     = "eu-funds-cloud-run-url-map"
}

variable "cloud_run_https_proxy_name" {
  type        = string
  description = "Target HTTPS proxy name for Cloud Run load balancer."
  default     = "eu-funds-cloud-run-https-proxy"
}

variable "cloud_run_https_forwarding_rule_name" {
  type        = string
  description = "Global forwarding rule name for HTTPS traffic to Cloud Run."
  default     = "eu-funds-cloud-run-https-fr"
}
