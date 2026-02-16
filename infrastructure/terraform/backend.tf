/*
Bootstrap notes:
1) Create the state bucket and KMS key once with:
   terraform -chdir=infrastructure/terraform apply -target=google_kms_key_ring.terraform_state -target=google_kms_crypto_key.terraform_state -target=google_storage_bucket.terraform_state
2) Then run:
   terraform -chdir=infrastructure/terraform init -reconfigure
*/

terraform {
  backend "gcs" {
    bucket         = "eu-funds-terraform-state-prod"
    prefix         = "cloud-run/production"
    encryption_key = "projects/eu-funds-prod/locations/europe-west1/keyRings/tf-state/cryptoKeys/tf-state-key"
  }
}

provider "google" {
  project = var.gcp_project_id
  region  = var.gcp_region
}

resource "google_kms_key_ring" "terraform_state" {
  name     = "tf-state"
  location = var.gcp_region
}

resource "google_kms_crypto_key" "terraform_state" {
  name            = "tf-state-key"
  key_ring        = google_kms_key_ring.terraform_state.id
  rotation_period = "7776000s" # 90 days
}

resource "google_storage_bucket" "terraform_state" {
  name                        = "eu-funds-terraform-state-prod"
  location                    = "EU"
  uniform_bucket_level_access = true
  force_destroy               = false
  public_access_prevention    = "enforced"

  versioning {
    enabled = true
  }

  encryption {
    default_kms_key_name = google_kms_crypto_key.terraform_state.id
  }

  lifecycle_rule {
    action {
      type = "Delete"
    }
    condition {
      num_newer_versions = 50
    }
  }
}
