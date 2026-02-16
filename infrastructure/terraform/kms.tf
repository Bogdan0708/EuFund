# KMS key for encrypting Terraform state and sensitive resources
resource "aws_kms_key" "terraform_state" {
  description             = "KMS key for EU Funds Terraform state encryption"
  deletion_window_in_days = 30
  enable_key_rotation     = true

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid    = "Enable IAM User Permissions"
        Effect = "Allow"
        Principal = {
          AWS = "arn:aws:iam::${data.aws_caller_identity.current.account_id}:root"
        }
        Action   = "kms:*"
        Resource = "*"
      },
      {
        Sid    = "Allow S3 to use the key"
        Effect = "Allow"
        Principal = {
          Service = "s3.amazonaws.com"
        }
        Action = [
          "kms:Decrypt",
          "kms:GenerateDataKey"
        ]
        Resource = "*"
      }
    ]
  })

  tags = {
    Name        = "EU Funds Terraform State KMS Key"
    Environment = "production"
    ManagedBy   = "terraform"
  }
}

resource "aws_kms_alias" "terraform_state" {
  name          = "alias/eu-funds-terraform-state"
  target_key_id = aws_kms_key.terraform_state.key_id
}

data "aws_caller_identity" "current" {}
