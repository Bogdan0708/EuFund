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
